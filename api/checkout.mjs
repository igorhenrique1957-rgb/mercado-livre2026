import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { offer } from "../offer.mjs";

const MAX_BODY_BYTES = 8192;
const PAYMENT_CODE = /^[A-Za-z0-9_-]{1,110}$/;
const DOCUMENT = /^(?:[0-9]{11}|[0-9]{14})$/;
const RECEIPT_LIFETIME_MS = 48 * 60 * 60 * 1000;

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function loadConfig(env) {
  const hostedUrl = httpsUrl(env.MANGOFY_CHECKOUT_URL);
  const base = httpsUrl(env.MANGOFY_API_BASE_URL);
  const apiKey = env.MANGOFY_API_KEY?.trim();
  const storeCode = env.MANGOFY_STORE_CODE?.trim();
  const api = base && !base.search && !base.hash && apiKey && storeCode ? {
    endpoint: base.href.replace(/\/+$/, "") + "/api/v1/payment",
    headers: {
      Authorization: apiKey,
      "Store-Code": storeCode,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    receiptKey: hkdfSync("sha256", apiKey, storeCode, "casa-de-pinheiro-recibo-pix-v1", 32),
  } : null;

  // The in-site checkout is available for a confirmed free-shipping offer.
  const direct = api && env.MANGOFY_PIX_FREE_SHIPPING === "true";
  return { hostedUrl, api, mode: hostedUrl ? "hosted" : direct ? "pix" : "unavailable" };
}

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sameOrigin(req) {
  try {
    const origin = new URL(req.headers.origin);
    const isLoopback = origin.hostname === "127.0.0.1" || origin.hostname === "localhost";
    return origin.host === req.headers.host
      && (origin.protocol === "https:" || (origin.protocol === "http:" && isLoopback))
      && req.headers["sec-fetch-site"] !== "cross-site";
  } catch {
    return false;
  }
}

async function readJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")) {
    return null;
  }
  if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) return null;
  try {
    let raw = req.body;
    if (raw === undefined) {
      const parts = [];
      let bytes = 0;
      for await (const chunk of req) {
        const part = Buffer.from(chunk);
        bytes += part.length;
        if (bytes > MAX_BODY_BYTES) return null;
        parts.push(part);
      }
      raw = Buffer.concat(parts);
    }
    const text = typeof raw === "string" ? raw
      : Buffer.isBuffer(raw) ? raw.toString("utf8") : JSON.stringify(raw);
    if (!text || Buffer.byteLength(text) > MAX_BODY_BYTES) return null;
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function clean(value, max) {
  if (typeof value !== "string") return "";
  const result = value.trim();
  return result.length <= max && !/[\x00-\x1f\x7f]/.test(result) ? result : "";
}

function digits(value, max) {
  return clean(value, max).replace(/\D/g, "");
}

function orderInput(body) {
  const { quantity } = body;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > offer.maxQuantity) return null;
  const source = body.customer ?? {};
  const name = clean(source.name, 100);
  const email = clean(source.email, 254);
  const document = digits(source.document, 22);
  const localPhone = digits(source.phone, 25);
  const phone = [10, 11].includes(localPhone.length) ? "55" + localPhone : localPhone;
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !DOCUMENT.test(document) || !/^55\d{10,11}$/.test(phone)) return null;
  const address = body.delivery ?? {};
  const metadata = {
    entrega_cep: digits(address.cep, 12),
    entrega_logradouro: clean(address.street, 100),
    entrega_numero: clean(address.number, 15),
    entrega_complemento: clean(address.complement, 60),
    entrega_bairro: clean(address.district, 70),
    entrega_cidade: clean(address.city, 80),
    entrega_uf: clean(address.state, 2).toUpperCase(),
  };
  const uf = /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/;
  if (!/^\d{8}$/.test(metadata.entrega_cep) || !metadata.entrega_logradouro
    || !metadata.entrega_numero || !metadata.entrega_bairro || !metadata.entrega_cidade
    || !uf.test(metadata.entrega_uf)) return null;
  return { quantity, customer: { name, email, document, phone }, metadata };
}

function sign(payload, key) {
  const content = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return content + "." + createHmac("sha256", key).update(content).digest("base64url");
}

function verify(token, key) {
  if (typeof token !== "string" || token.length > 900) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((word) => /^[A-Za-z0-9_-]+$/.test(word))) return null;
  const [content, signature] = parts;
  const expected = createHmac("sha256", key).update(content).digest();
  const claimed = Buffer.from(signature, "base64url");
  if (claimed.length !== expected.length || !timingSafeEqual(expected, claimed)) return null;
  try {
    const payload = JSON.parse(Buffer.from(content, "base64url").toString("utf8"));
    return typeof payload.code === "string" && PAYMENT_CODE.test(payload.code)
      && Number.isSafeInteger(payload.amount) && payload.amount > 0
      && payload.expires > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function matchesPayment(payment, order) {
  return payment && payment.payment_method === "pix" && payment.payment_code === order.code
    && payment.external_code === order.reference && payment.payment_amount === order.amount
    && payment.shipping_amount === 0;
}

async function askMangoFy(api, url, options) {
  const response = await fetch(url, {
    ...options,
    headers: api.headers,
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("MangoFy respondeu com erro.");
  return response.json();
}

async function createPix(req, res, api, body) {
  const input = orderInput(body);
  if (!input) return send(res, 400, { message: "Confira a quantidade, seus dados e o endereço de entrega." });
  const reference = "casa-pinheiro-" + randomUUID();
  const amount = offer.unitPriceInCents * input.quantity;
  const forwardedIp = process.env.VERCEL === "1" ? req.headers["x-vercel-forwarded-for"] : "";
  const ip = typeof forwardedIp === "string" ? forwardedIp.split(",")[0].trim() : "";
  if (ip && isIP(ip)) input.customer.ip = ip;
  const payment = await askMangoFy(api, api.endpoint, {
    method: "POST",
    body: JSON.stringify({
      external_code: reference,
      payment_method: "pix",
      payment_format: "regular",
      installments: 1,
      payment_amount: amount,
      shipping_amount: 0,
      items: [{
        code: offer.sku,
        name: offer.name,
        quantity: input.quantity,
        price: offer.unitPriceInCents,
        digital_flag: false,
      }],
      customer: input.customer,
      pix: { expires_in_days: 1 },
      extra: { metadata: input.metadata },
    }),
  });
  const code = payment?.payment_code;
  const order = { code, reference, amount, expires: Date.now() + RECEIPT_LIFETIME_MS };
  const qrText = clean(payment?.pix?.pix_qrcode_text, 1500);
  const image = payment?.pix?.pix_qrcode_image;
  if (typeof code !== "string" || !PAYMENT_CODE.test(code) || !matchesPayment(payment, order)
    || payment.payment_status !== "pending" || !qrText.startsWith("000201") || qrText.length < 25) {
    throw new Error("A cobrança recebida diverge do pedido.");
  }
  const qrImage = typeof image === "string" && image.length <= 262144
    && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image) ? image : "";
  return send(res, 201, {
    amount,
    code,
    qrText,
    qrImage,
    receipt: sign(order, api.receiptKey),
  });
}

async function checkPix(res, api, body) {
  const order = verify(body.receipt, api.receiptKey);
  if (!order) return send(res, 400, { message: "O comprovante da sessão é inválido ou expirou." });
  const payment = await askMangoFy(api, api.endpoint + "/" + encodeURIComponent(order.code), { method: "GET" });
  if (!matchesPayment(payment, order)) throw new Error("O pagamento consultado diverge do pedido.");
  const status = payment.payment_status;
  return send(res, 200, {
    status: ["approved", "pending", "expired", "refused", "canceled", "cancelled", "refunded"].includes(status) ? status : "unknown",
    code: order.code,
    amount: order.amount,
  });
}

export default async function checkout(req, res) {
  const config = loadConfig(process.env);
  if (req.method === "GET") {
    return send(res, 200, {
      mode: config.mode,
      checkoutUrl: config.hostedUrl?.href,
      unitPriceInCents: offer.unitPriceInCents,
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { message: "Método indisponível." });
  }
  if (!sameOrigin(req)) return send(res, 403, { message: "Abra o checkout pelo site da oferta." });
  const body = await readJson(req);
  if (!body) return send(res, 400, { message: "Pedido inválido." });
  if (!config.api) return send(res, 503, { message: "O checkout está em preparação." });
  try {
    if (body.action === "status") return await checkPix(res, config.api, body);
    if (body.action !== "create") return send(res, 400, { message: "Ação inválida." });
    if (config.mode !== "pix") return send(res, 409, { message: "Use o checkout informado na página do produto." });
    return await createPix(req, res, config.api, body);
  } catch {
    return send(res, 502, { message: "A MangoFy não confirmou a operação. Verifique o pedido antes de gerar outra cobrança." });
  }
}
