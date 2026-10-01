/** @param {object} payload @param {string} initData @param {typeof fetch} fetchImpl */
export async function submitOrder(payload,initData,fetchImpl=globalThis.fetch){
 if(!initData)throw new Error('Откройте каталог из Telegram-бота заново.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
 try{
  let response;
  try{response=await fetchImpl('/api/catalog-v5/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,initData}),credentials:'same-origin',signal:controller.signal});}
  catch{throw new Error('Проверьте соединение и повторите отправку этой же заявки.');}
  let body;
  try{body=await response.json();}catch{throw new Error('Сервер временно недоступен. Повторите отправку этой же заявки.');}
  if(!response.ok||body?.ok!==true||body?.delivered!==true||typeof body.orderId!=='string'||!Number.isFinite(body.total))throw new Error(body?.error||'Передача менеджеру не подтверждена. Повторите отправку.');
  return body;
 }finally{clearTimeout(timer);}
}

/** Preserve retry identity without persisting signed Telegram session data. */
export function reuseRequest(input,previousJson,newId){
 try{const previous=JSON.parse(previousJson);const {requestId,...data}=previous;if(typeof requestId==='string'&&JSON.stringify(data)===JSON.stringify(input))return previous;}catch{}
 return {...input,requestId:newId};
}
