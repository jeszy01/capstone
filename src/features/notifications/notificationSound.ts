import {getCurrentUser} from '../auth/authService';
import {NOTIFICATIONS_EVENT,notificationRole,unreadCount} from './notificationService';

const SOUND_URL='/sounds/notification.mp3';
// Saved per user on this device; on by default.
const soundKey=()=>`pbms:notification-sound:${getCurrentUser()?.id??''}`;
export function notificationSoundOn(){try{return localStorage.getItem(soundKey())!=='off'}catch{return true}}
export function setNotificationSoundOn(on:boolean){try{localStorage.setItem(soundKey(),on?'on':'off')}catch{/* storage is optional */}}

let unlocked=false,playingUntil=0;
/** How long a page reload should wait so a sound that just started is not cut off. */
export const soundHoldMs=()=>Math.max(0,playingUntil-Date.now());

// Browsers block audio until the user interacts with the page: the first click or key press plays a muted clip to unlock it.
function unlock(){
 if(unlocked)return;
 const audio=new Audio(SOUND_URL);audio.muted=true;
 audio.play().then(()=>{audio.pause();unlocked=true}).catch(()=>undefined);
}
async function play(){
 if(!unlocked||!notificationSoundOn())return;
 try{playingUntil=Date.now()+1500;await new Audio(SOUND_URL).play()}catch{/* autoplay blocked */}
}

/** Plays the sound when the signed-in role's unread count rises after a server sync, never on first load. Returns a cleanup function. */
export function watchNotificationSound(){
 let last=unreadCount(notificationRole());
 const onEvent=(event:Event)=>{
  const count=unreadCount(notificationRole());
  if((event as CustomEvent<{source?:string}>).detail?.source==='poll'&&count>last)void play();
  last=count;
 };
 window.addEventListener(NOTIFICATIONS_EVENT,onEvent);
 window.addEventListener('pointerdown',unlock,{capture:true});
 window.addEventListener('keydown',unlock,{capture:true});
 return()=>{window.removeEventListener(NOTIFICATIONS_EVENT,onEvent);window.removeEventListener('pointerdown',unlock,{capture:true});window.removeEventListener('keydown',unlock,{capture:true})};
}
