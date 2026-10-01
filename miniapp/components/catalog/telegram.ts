export type TelegramApp={initData:string;platform?:string;ready:()=>void;expand:()=>void;sendData:(data:string)=>void;setHeaderColor?:(color:string)=>void;setBackgroundColor?:(color:string)=>void;BackButton?:{show:()=>void;hide:()=>void;onClick:(fn:()=>void)=>void;offClick:(fn:()=>void)=>void};HapticFeedback?:{notificationOccurred:(type:'success'|'error'|'warning')=>void}};
declare global{interface Window{Telegram?:{WebApp?:TelegramApp}}}
export const getTelegram=()=>{const app=typeof window!=='undefined'?window.Telegram?.WebApp:undefined;return app&&app.platform&&app.platform!=='unknown'?app:undefined;};
export function authenticatedLaunch(){return Boolean(getTelegram()?.initData);}
