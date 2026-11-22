"use strict";

const find = (selector) => document.querySelector(selector);
const formatMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const storageKey = "casa-de-pinheiro:v1";
const variantSelect = find("#variant");
const galleryStage = find("#gallery-stage");
const galleryImage = find("#gallery-image");
const galleryVideo = find("#gallery-video");
const quantity = find("#quantity-value");
const favoriteButton = find("#save-product");
const addButton = find("#add-cart");
const panel = find("#panel");
const panelBody = find("#panel-body");
const lightbox = find("#lightbox");
const toast = find("#status");

let selectedVariant = catalog.defaultVariant;
let slide = 0;
let toastTimer;
let state = readState();
let openPanelName = "";

function clampQuantity(value, min = 1) {
  return Math.max(min, Math.min(catalog.availableQuantity, Math.trunc(Number(value)) || 0));
}

function readState() {
  try {
    const previous = JSON.parse(localStorage.getItem(storageKey));
    return {
      cart: clampQuantity(previous?.cart, 0),
      favorites: Array.isArray(previous?.favorites)
        ? new Set(previous.favorites.filter((key) => Object.hasOwn(catalog.variants, key)))
        : new Set(),
    };
  } catch {
    return { cart: 0, favorites: new Set() };
  }
}

function saveState() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      cart: state.cart,
      favorites: [...state.favorites],
    }));
  } catch {
    // Keep the current session usable when local storage is unavailable.
  }
  renderCounters();
}

function photoPath(name) {
  return "assets/" + name + ".webp";
}

function renderCounters() {
  const saved = state.favorites.has(selectedVariant);
  favoriteButton.setAttribute("aria-pressed", String(saved));
  favoriteButton.setAttribute("aria-label", saved ? "Remover o produto dos favoritos" : "Salvar o produto nos favoritos");
  find("#favorite-indicator").hidden = state.favorites.size === 0;
  find("#bag-count").textContent = state.cart;
  find(".bag-button").setAttribute("aria-label", state.cart > 0
    ? "Abrir carrinho, " + state.cart + (state.cart === 1 ? " unidade" : " unidades")
    : "Abrir carrinho, vazio");
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toastTimer = setTimeout(() => { toast.textContent = ""; }, 3300);
}

function displayMedia(item) {
  const video = Boolean(item.video);
  if (!video && !galleryVideo.paused) galleryVideo.pause();
  galleryStage.classList.toggle("is-video", video);
  find("#gallery-image-button").hidden = video;
  find("#expand-image").hidden = video;
  galleryVideo.hidden = !video;
  if (video) {
    galleryVideo.play().catch(() => {});
  } else {
    galleryImage.src = photoPath(item.photo);
    galleryImage.alt = item.alt;
  }
}

function selectSlide(index) {
  slide = (index + catalog.media.length) % catalog.media.length;
  find("#gallery-counter").textContent = (slide + 1) + " / " + catalog.media.length;
  document.querySelectorAll("[data-media]").forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.media) === slide));
  });
  displayMedia(catalog.media[slide]);
}

function renderVariant() {
  const variant = catalog.variants[selectedVariant];
  const hasMainOffer = selectedVariant === catalog.defaultVariant;
  const hasOwnPhoto = !hasMainOffer && Boolean(variant.photo);
  const description = variant.label + " de altura · " + variant.branches + " galhos · Verde";
  find("#product-subtitle").textContent = description;
  find("#buy-link").href = variant.url || catalog.original;
  find("#buy-link").textContent = hasMainOffer ? "Comprar no Mercado Livre" : "Ver esta versão no Mercado Livre";
  for (const selector of ["#default-rating", "#default-offer", "#gift-note", "#quantity", "#add-cart", "#stock-note"]) {
    find(selector).hidden = !hasMainOffer;
  }
  find("#alternate-offer").hidden = hasMainOffer;
  find("#gallery-thumbs").hidden = hasOwnPhoto;
  find("#gallery-paging").hidden = hasOwnPhoto;
  find("#gallery-caption").textContent = hasOwnPhoto
    ? "Imagem da opção selecionada no anúncio."
    : "Fotos e vídeo da versão de 1,80 m com 800 galhos.";
  if (hasOwnPhoto) {
    displayMedia({ photo: variant.photo, alt: "Imagem da versão selecionada: " + description });
  } else {
    selectSlide(0);
  }
  renderCounters();
}

function setHeight(height) {
  variantSelect.replaceChildren();
  for (const [key, version] of Object.entries(catalog.variants)) {
    if (version.height === height) {
      variantSelect.add(new Option("Verde · " + version.branches + " galhos", key));
    }
  }
  selectedVariant = variantSelect.value;
  renderVariant();
}

function updateQuantity(value) {
  const clamped = clampQuantity(value);
  quantity.value = clamped;
  find("#quantity-minus").disabled = clamped <= 1;
  find("#quantity-plus").disabled = clamped >= catalog.availableQuantity;
}

function setLightbox(source, alt) {
  const image = find("#lightbox-image");
  image.src = source;
  image.alt = alt;
  lightbox.showModal();
}

function externalLink(label, url, className = "text-link") {
  return '<a class="' + className + '" href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
}

function productItem(key, description, action) {
  const variant = catalog.variants[key];
  const alt = variant.photo ? "Foto do pinheiro" : "Foto da versão de 1,80 m";
  return '<article class="panel-item"><img src="' + photoPath(variant.photo || "pinheiro") + '" alt="' + alt + '" width="100" height="100">'
    + "<div><h3>Pinheiro Canadense Greycom</h3><p>" + variant.label + " · " + variant.branches + " galhos</p>"
    + description + action + "</div></article>";
}

const panels = {
  delivery: {
    title: "Entrega e retirada",
    body: () => '<p>O anúncio consultado oferecia <strong>frete grátis acima de R$ 19</strong>, entrega a partir de 2 de dezembro e retirada grátis em agência a partir de 14 de dezembro.</p>'
      + '<p>O produto é armazenado e enviado pelo Full. Consulte as condições atuais para o seu CEP no anúncio.</p>'
      + externalLink("Ver prazo no anúncio", catalog.original, "button button-primary")
      + externalLink("Ver agências no mapa", catalog.pickup),
  },
  payments: {
    title: "Meios de pagamento",
    body: () => '<p>Na oferta consultada, <strong>R$ 204,30 no Pix</strong> (59% de desconto sobre R$ 500,00) ou <strong>R$ 227,00</strong> em outros meios.</p>'
      + '<ul class="panel-list"><li>Mercado Parcelado</li><li>Cartões de crédito em até 3 vezes</li><li>Pix</li><li>Boleto bancário</li></ul>'
      + '<p>O anúncio também oferecia <strong>20% de desconto com saldo no Mercado Pago</strong>, sujeito às condições da promoção original.</p>'
      + externalLink("Conferir condições de pagamento", catalog.payments, "button button-primary"),
  },
  coupons: {
    title: "Cupons da oferta",
    body: () => '<p><strong>R$ 200,70</strong> era o valor com o cupom por seguir a loja Greycom. Confira a disponibilidade e as regras no anúncio.</p>'
      + externalLink("Ver cupons disponíveis", catalog.coupons, "button button-primary")
      + externalLink("Visitar a loja Greycom", catalog.seller),
  },
  cart: {
    title: "Seu carrinho",
    body: () => {
      if (!state.cart) return "<p>Seu carrinho está vazio.</p>";
      const total = formatMoney.format(state.cart * catalog.pixPriceInCents / 100);
      const item = productItem(catalog.defaultVariant,
        "<p>" + state.cart + (state.cart === 1 ? " unidade" : " unidades") + "</p>",
        '<button class="text-button" type="button" data-remove-cart>Remover</button>');
      return item + '<div class="cart-total"><span>Subtotal no Pix</span><span>' + total + "</span></div>"
        + externalLink("Abrir oferta no Mercado Livre", catalog.original, "button button-primary")
        + '<p class="fine-print">A quantidade acima fica salva neste navegador. Selecione a quantidade e confirme o preço e o estoque no Mercado Livre.</p>';
    },
  },
  favorites: {
    title: "Seus favoritos",
    body: () => {
      if (!state.favorites.size) return "<p>Os pinheiros que você salvar aparecem aqui.</p>";
      return [...state.favorites].map((key) => productItem(key, "",
        externalLink("Ver anúncio", catalog.variants[key].url || catalog.original)
        + ' · <button class="text-button" type="button" data-remove-favorite="' + key + '">Remover</button>')).join("");
    },
  },
  share: {
    title: "Compartilhar",
    body: () => '<label for="share-url">Link para esta página</label><input id="share-url" class="share-url" type="url" readonly>',
  },
};

function renderPanel(name) {
  const content = panels[name];
  find("#panel-title").textContent = content.title;
  panelBody.innerHTML = content.body();
  if (name === "share") {
    find("#share-url").value = new URL(".", window.location.href).href;
  }
}

function showPanel(name) {
  openPanelName = name;
  renderPanel(name);
  if (!panel.open) panel.showModal();
  if (name === "share") {
    find("#share-url").focus();
    find("#share-url").select();
  }
}

function toggleFavorite(key) {
  if (state.favorites.has(key)) {
    state.favorites.delete(key);
    showToast("Produto removido dos favoritos.");
  } else {
    state.favorites.add(key);
    showToast("Produto salvo nos favoritos.");
  }
  saveState();
}

function handlePanelClick(event) {
  const remove = event.target.closest("[data-remove-cart], [data-remove-favorite]");
  if (!remove) return;
  if (remove.hasAttribute("data-remove-cart")) {
    state.cart = 0;
    saveState();
  } else {
    toggleFavorite(remove.dataset.removeFavorite);
  }
  renderPanel(openPanelName);
  panel.querySelector("[data-close]").focus();
}

async function shareProduct() {
  try {
    const publicUrl = new URL(".", window.location.href);
    await navigator.clipboard.writeText(publicUrl.href);
    showToast("Link da página copiado.");
  } catch {
    showPanel("share");
  }
}

async function loadRelated() {
  const response = await fetch("related.json");
  if (!response.ok) return;
  const entries = await response.json();
  if (!entries.length) return;
  const items = entries.map((entry) => {
    const item = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = entry.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    if (entry.image) {
      const img = new Image(44, 44);
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.src = entry.image;
      anchor.append(img);
    }
    const title = document.createElement("span");
    title.textContent = entry.title;
    if (entry.price) {
      const price = document.createElement("strong");
      price.textContent = entry.price;
      title.append(price);
    }
    anchor.append(title);
    item.append(anchor);
    return item;
  });
  find("#related-list").append(...items);
  find("#related-products").hidden = false;
}

document.querySelectorAll(".icon").forEach((svg) => svg.setAttribute("aria-hidden", "true"));
document.querySelectorAll("input[name=height]").forEach((radio) => {
  radio.addEventListener("change", () => setHeight(radio.value));
});
variantSelect.addEventListener("change", () => {
  selectedVariant = variantSelect.value;
  renderVariant();
});
find("#quantity-minus").addEventListener("click", () => updateQuantity(clampQuantity(quantity.value) - 1));
find("#quantity-plus").addEventListener("click", () => updateQuantity(clampQuantity(quantity.value) + 1));
quantity.addEventListener("change", () => updateQuantity(quantity.value));
favoriteButton.addEventListener("click", () => toggleFavorite(selectedVariant));
addButton.addEventListener("click", () => {
  updateQuantity(quantity.value);
  state.cart = clampQuantity(state.cart + Number(quantity.value));
  saveState();
  showPanel("cart");
});
find("#share-button").addEventListener("click", shareProduct);

for (const button of document.querySelectorAll("[data-open]")) {
  button.addEventListener("click", () => showPanel(button.dataset.open));
}
for (const button of document.querySelectorAll("[data-media]")) {
  button.addEventListener("click", () => selectSlide(Number(button.dataset.media)));
}
for (const button of document.querySelectorAll("[data-slide]")) {
  button.addEventListener("click", () => selectSlide(slide + Number(button.dataset.slide)));
}
for (const button of [find("#expand-image"), find("#gallery-image-button")]) {
  button.addEventListener("click", () => setLightbox(galleryImage.src, galleryImage.alt));
}
for (const button of document.querySelectorAll("[data-review-photo]")) {
  const img = button.querySelector("img");
  button.addEventListener("click", () => setLightbox(img.src, img.alt));
}
for (const dialog of [panel, lightbox]) {
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}
panel.addEventListener("close", () => { openPanelName = ""; });
panelBody.addEventListener("click", handlePanelClick);
window.addEventListener("storage", (event) => {
  if (event.key !== storageKey && event.key !== null) return;
  state = readState();
  renderCounters();
  if (panel.open && (openPanelName === "cart" || openPanelName === "favorites")) {
    renderPanel(openPanelName);
  }
});

updateQuantity(quantity.value);
renderCounters();
loadRelated().catch(() => {});
