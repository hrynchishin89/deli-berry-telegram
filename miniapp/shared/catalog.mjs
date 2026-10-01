// Source: owner-approved MASTER_CATALOG_v5, 2026-09-28.
export const catalogVersion='v5-2026-09-28';
export const points=[{id:'discovery',name:'Discovery'},{id:'zelenopark',name:'Зеленопарк'}];
export const families=[
 {id:'SET-09',name:'Набор клубники — 9 ягод',shortName:'Набор · 9 ягод',category:'sets',photo:'B04',designs:['B04','C04']},
 {id:'SET-12',name:'Набор клубники — 12 ягод',shortName:'Набор · 12 ягод',category:'sets',photo:'B02',designs:['B02','A06']},
 {id:'SET-16',name:'Набор клубники — 16 ягод',shortName:'Набор · 16 ягод',category:'sets',photo:'A01',designs:['A01','B01','B03','B07']},
 {id:'SET-25',name:'Набор свежей клубники — 25 ягод',shortName:'Набор · 25 ягод',category:'sets',photo:'',designs:[],note:'Только крафтовая коробка.'},
 {id:'MIX-BANANA',name:'Клубника и бананы в шоколаде — 12 клубник и 2 банана',shortName:'Клубника и бананы',category:'sets',photo:'C02',designs:['C02'],note:'12 ягод клубники и 2 банана.'},
 {id:'BQT-A07',name:'Букет A07 — 19 ягод',shortName:'Букет A07 · 19 ягод',category:'bouquets',photo:'A07',designs:['A07']},
 {id:'BQT-B09',name:'Букет B09 — 19 ягод',shortName:'Букет B09 · 19 ягод',category:'bouquets',photo:'B09',designs:['B09']},
 {id:'BQT-B10',name:'Букет B10 — 35 ягод',shortName:'Букет B10 · 35 ягод',category:'bouquets',photo:'B10',designs:['B10']},
 {id:'BQT-A08',name:'Букет A08 — 39 ягод',shortName:'Букет A08 · 39 ягод',category:'bouquets',photo:'A08',designs:['A08']},
];
const v=(id,familyId,type,price,photo,includedBerry=false)=>({id,familyId,type,price,photo,includedBerry});
export const variants=[
 v('SET-09-FRESH','SET-09','fresh',1190,'B04'),v('SET-09-FD','SET-09','fd',890,'B04'),
 v('SET-12-FRESH','SET-12','fresh',1590,'B02'),v('SET-12-A06','SET-12','fresh',1790,'A06',true),v('SET-12-FD','SET-12','fd',990,'B02'),
 v('SET-16-FRESH','SET-16','fresh',1990,'A01'),v('SET-16-FD','SET-16','fd',1250,'A01'),
 v('SET-25-FRESH','SET-25','fresh',2790,''),v('MIX-BANANA-C02','MIX-BANANA','fresh',1990,'C02'),
 v('BQT-A07-FRESH','BQT-A07','fresh',2750,'A07'),
 v('BQT-A08-FRESH','BQT-A08','fresh',4890,'A08'),v('BQT-A08-FD','BQT-A08','fd',3290,'A08'),
 v('BQT-B09-FRESH','BQT-B09','fresh',2790,'B09'),v('BQT-B09-FD','BQT-B09','fd',1690,'B09'),
 v('BQT-B10-FRESH','BQT-B10','fresh',4390,'B10'),v('BQT-B10-FD','BQT-B10','fd',2950,'B10'),
];
export const typeLabel=t=>t==='fd'?'Сублимированная клубника':'Свежая клубника';
export const money=n=>new Intl.NumberFormat('ru-RU').format(n)+' ₽';
export const photoUrl=id=>'./products/'+id+'.webp';
export function getVariant(id){const v=variants.find(v=>v.id===id);if(!v)throw new Error('Вариант отсутствует в действующем каталоге.');return v;}
export function getFamily(id){const f=families.find(f=>f.id===id);if(!f)throw new Error('Товар не найден.');return f;}
export const forFamily=(id,type='')=>variants.filter(v=>v.familyId===id&&(!type||v.type===type));
