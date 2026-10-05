import {catalogVersion,getVariant,getFamily,money,points,typeLabel} from './catalog.mjs';
/** @typedef {{variantId:string,quantity:number,design:string,berry:string,inscription:string}} CartItem */
/** @param {CartItem} item */
export function priceItem(item){
 if(!item||typeof item!=='object')throw new Error('Не удалось прочитать товар.');
 const variant=getVariant(item.variantId),family=getFamily(variant.familyId);
 if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>99)throw new Error('Количество должно быть от 1 до 99.');
 if(!['none','blueberry','raspberry','included'].includes(item.berry))throw new Error('Проверьте украшение.');
 if(item.berry==='included'&&!variant.includedBerry)throw new Error('Украшение не включено в этот вариант.');
 if(typeof item.inscription!=='string'||item.inscription.length>100)throw new Error('Надпись: не более 100 символов.');
 const design=item.design||variant.photo;
 if(design&&!family.designs.includes(design))throw new Error('Оформление недоступно для этого набора.');
 if(family.id==='SET-12'&&design!==variant.photo)throw new Error('Оформление не соответствует варианту из 12 ягод.');
 const inscription=item.inscription.trim(),berry=variant.includedBerry?'included':item.berry;
 const unitPrice=variant.price+(variant.includedBerry||berry==='none'?0:200)+(inscription?250:0);
 return {variantId:variant.id,quantity:item.quantity,design,berry,inscription,family,variant,unitPrice,total:unitPrice*item.quantity};
}
/** @param {CartItem[]} items */
export function priceCart(items){if(!Array.isArray(items)||!items.length)throw new Error('Добавьте товар в корзину.');if(items.length>20)throw new Error('В одной заявке — до 20 разных позиций.');const lines=items.map(priceItem);return {lines,total:lines.reduce((n,l)=>n+l.total,0)};}
export const moscowDate=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
/** @param {{version:string,requestId:string,items:CartItem[],point:string,date:string,time:string,comment:string}} input */
export function validateOrder(input,now=new Date()){
 if(!input||input.version!==catalogVersion)throw new Error('Каталог обновился. Перезагрузите приложение.');
 if(typeof input.requestId!=='string'||!/^[a-zA-Z0-9-]{8,64}$/.test(input.requestId))throw new Error('Не удалось определить номер заявки.');
 const point=points.find(p=>p.id===input.point);if(!point)throw new Error('Выберите точку получения.');
 if(typeof input.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||typeof input.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))throw new Error('Укажите дату и время получения.');
 const requested=new Date(`${input.date}T${input.time}:00+03:00`);
 if(!Number.isFinite(requested.getTime())||moscowDate(requested)!==input.date||requested<=now)throw new Error('Выберите будущую дату и время по Москве.');
 if(typeof input.comment!=='string'||input.comment.length>500)throw new Error('Комментарий: не более 500 символов.');
 return {...priceCart(input.items),point,date:input.date,time:input.time,comment:input.comment.trim(),requestId:input.requestId};
}
/** @param {ReturnType<typeof validateOrder>} o */
export function orderText(o){return ['Дели Берри · заявка '+o.requestId,...o.lines.map((l,i)=>[
 `${i+1}. ${l.family.name}`,typeLabel(l.variant.type),l.design?'Пример оформления: '+l.design:'Крафтовая коробка',
 l.berry==='included'?'Ягодное украшение включено':l.berry==='blueberry'?'Голубика +200 ₽':l.berry==='raspberry'?'Малина +200 ₽':'',
 l.inscription?'Шоколадная надпись +250 ₽: '+l.inscription:'',`${l.quantity} × ${money(l.unitPrice)} = ${money(l.total)}`].filter(Boolean).join('\n')),
 'Итого по выбранным опциям: '+money(o.total),'Самовывоз: '+o.point.name,`Желаемые дата и время: ${o.date}, ${o.time} МСК`,o.comment?'Пожелания: '+o.comment:'',
 'Время, оформление и полную стоимость согласуем перед оплатой. Заказ к дате — по полной предоплате.'].filter(Boolean).join('\n\n');}
