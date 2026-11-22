import { offer } from "./offer.mjs";

const SESSION_KEY = "casa-de-pinheiro:pix-pendente";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const terminal = new Set(["approved", "expired", "refused", "canceled", "cancelled", "refunded"]);

function readPayment() {
  try {
    const payment = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    return payment?.receipt && payment?.qrText && Number.isInteger(payment?.count)
      && payment.count >= 1 && payment.count <= offer.maxQuantity ? payment : null;
  } catch {
    return null;
  }
}

function keepPayment(value) {
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // The current checkout still works when browser storage is unavailable.
  }
}

async function requestCheckout(body) {
  const options = body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : { cache: "no-store" };
  const response = await fetch("/api/checkout", options);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw new Error(result?.message || "O checkout está indisponível no momento.");
  }
  return result;
}

function formCustomer(form) {
  const data = new FormData(form);
  const [name, email, document, phone] = ["name", "email", "document", "phone"].map((key) => data.get(key));
  const [cep, street, number, complement, district, city, state] = [
    "cep", "street", "number", "complement", "district", "city", "state",
  ].map((key) => data.get(key));
  return { customer: { name, email, document, phone }, delivery: { cep, street, number, complement, district, city, state } };
}

export function setupCheckout({ getQuantity, onAvailable, onPaid }) {
  const byId = (id) => document.getElementById(id);
  const dialog = byId("pix-checkout");
  const form = byId("pix-form");
  const result = byId("pix-result");
  const feedback = byId("pix-feedback");
  const generate = byId("generate-pix");
  const check = byId("check-pix");
  const copyInput = byId("pix-copy-value");
  const buy = byId("buy-pix");
  const note = byId("payment-note");

  let mode = "unavailable";
  let hostedUrl;
  let selection;
  let active = readPayment();

  function showOrder(count) {
    byId("pix-product-summary").textContent = count + (count === 1 ? " pinheiro Greycom" : " pinheiros Greycom");
    byId("pix-total").textContent = money.format(offer.unitPriceInCents * count / 100);
  }

  function showForm() {
    showOrder(selection.count);
    result.hidden = true;
    form.hidden = false;
    feedback.textContent = "Frete grátis nesta modalidade de checkout.";
  }

  function displayPix() {
    const finished = terminal.has(active.status);
    showOrder(active.count);
    form.hidden = true;
    result.hidden = false;
    byId("pix-reference").textContent = "Pedido MangoFy " + active.code;
    byId("pix-payment-code").hidden = finished;
    byId("pix-result-title").textContent = finished ? "Status do pagamento" : "Código Pix";
    copyInput.value = finished ? "" : active.qrText;
    const image = byId("pix-qr");
    image.hidden = finished || !active.qrImage;
    if (image.hidden) image.removeAttribute("src");
    else image.src = active.qrImage;
    check.hidden = finished;
    byId("new-pix").hidden = !finished;
    const messages = {
      approved: "Pagamento confirmado pela MangoFy.",
      pending: "Aguardando o Pix. Assim que pagar, verifique a confirmação.",
      unknown: "A MangoFy ainda está processando o pagamento. Consulte novamente em instantes.",
      expired: "O código Pix expirou.",
      refused: "O pagamento foi recusado.",
      canceled: "O pagamento foi cancelado.",
      cancelled: "O pagamento foi cancelado.",
      refunded: "O pagamento foi estornado.",
    };
    feedback.textContent = messages[active.status] ?? messages.unknown;
  }

  async function checkPayment() {
    if (!active || check.disabled) return;
    check.disabled = true;
    try {
      const payment = await requestCheckout({ action: "status", receipt: active.receipt });
      if (payment.code !== active.code || payment.amount !== offer.unitPriceInCents * active.count) {
        throw new Error("O valor consultado diverge deste pedido.");
      }
      const previous = active.status;
      active.status = payment.status;
      keepPayment(active);
      displayPix();
      if (payment.status === "approved" && previous !== "approved") onPaid(active.source, active.count);
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      check.disabled = false;
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-checkout]");
    if (!button || button.disabled) return;
    if (mode === "hosted") {
      window.location.assign(hostedUrl);
      return;
    }
    if (mode !== "pix") return;
    const source = button.dataset.checkout;
    const count = getQuantity(source);
    if (count < 1) return;
    selection = { source, count };
    if (active) displayPix();
    else showForm();
    if (!dialog.open) dialog.showModal();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (generate.disabled || !selection) return;
    const order = selection;
    generate.disabled = true;
    feedback.textContent = "Gerando código Pix…";
    try {
      const payment = await requestCheckout({ action: "create", quantity: order.count, ...formCustomer(form) });
      if (!payment.receipt || !payment.qrText || payment.amount !== offer.unitPriceInCents * order.count) {
        throw new Error("O código não corresponde ao valor da oferta.");
      }
      active = { ...payment, count: order.count, source: order.source, status: "pending" };
      keepPayment(active);
      form.reset();
      displayPix();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      generate.disabled = false;
    }
  });

  byId("close-checkout").addEventListener("click", () => dialog.close());
  byId("copy-pix").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(copyInput.value);
      feedback.textContent = "Código Pix copiado.";
    } catch {
      copyInput.focus();
      copyInput.select();
      feedback.textContent = "Selecione e copie o código Pix.";
    }
  });
  check.addEventListener("click", checkPayment);
  byId("new-pix").addEventListener("click", () => {
    active = null;
    keepPayment(null);
    dialog.close();
  });

  requestCheckout().then((config) => {
    if (config.unitPriceInCents !== offer.unitPriceInCents) return;
    if (config.mode === "hosted") {
      const destination = new URL(config.checkoutUrl);
      if (destination.protocol !== "https:" || destination.username || destination.password) return;
      hostedUrl = destination.href;
      mode = "hosted";
    } else if (config.mode === "pix") {
      mode = "pix";
    }
  }).catch(() => {}).finally(() => {
    buy.disabled = mode === "unavailable";
    note.textContent = mode === "hosted"
      ? "Pagamento no checkout MangoFy. Confira a quantidade e a entrega."
      : mode === "pix" ? "Pagamento com Pix pela MangoFy." : "Checkout em preparação.";
    onAvailable();
  });

  return { isAvailable: () => mode !== "unavailable" };
}
