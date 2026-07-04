
let catalog = [
  {name:"Клубника в шоколаде", price:2599},
  {name:"Подарочный набор", price:3999},
  {name:"Дубайский шоколад", price:4999}
];

let cart = [];

function openCatalog(){
  const el = document.getElementById('catalog');
  el.innerHTML = "";
  catalog.forEach((p,i)=>{
    el.innerHTML += `
      <div class="card">
        <div>${p.name}<br><small>${p.price} ₽</small></div>
        <button onclick="add(${i})">+</button>
      </div>
    `;
  });
}

function add(i){
  cart.push(catalog[i]);
  renderCart();
}

function renderCart(){
  document.getElementById('cartInfo').innerText =
    "В корзине: " + cart.length + " товаров";
}

function checkout(){
  alert("Заказ отправлен 🍓");
}
