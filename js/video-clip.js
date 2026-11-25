import {clipRange} from './video-review.js';
const TYPES=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
export function clipFormat(canvas,Recorder=globalThis.MediaRecorder){
 if(typeof canvas?.captureStream!=='function'||typeof Recorder!=='function')return null;
 const type=TYPES.find(t=>Recorder.isTypeSupported?.(t));
 return type?{type,extension:type.startsWith('video/mp4')?'mp4':'webm'}:null;
}
// Real-time, silent capture of a bounded local excerpt. Stop on hidden tab,
// cancellation or seek/playback failure. Restore the original preview position.
export async function captureLocalClip(video,{start,end,signal,onProgress=()=>{}}={}){
 const range=clipRange(start,end,video.duration),canvas=document.createElement('canvas'),format=clipFormat(canvas);
 if(!format)throw Error('Этот браузер не поддерживает экспорт видеофрагмента. Используйте стоп-кадр или другой браузер.');
 if(!video.videoWidth||!video.videoHeight||!video.paused&&video.seeking)throw Error('Сначала откройте видео');
 if(signal?.aborted||document.hidden)throw Error('Экспорт отменён');
 const scale=Math.min(1,1280/video.videoWidth,720/video.videoHeight),previous={time:video.currentTime,rate:video.playbackRate,muted:video.muted};
 canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
 const ctx=canvas.getContext('2d');let stream,rec,frame,timer,seekTimer,abortSeek,seekDone;const chunks=[];let size=0,stopping=false;
 const cancelError=()=>Error('Экспорт видео отменён');
 try{
  video.pause();video.muted=true;video.playbackRate=1;
  if(Math.abs(video.currentTime-range.start)>.03||video.seeking)await new Promise((resolve,reject)=>{
   const finish=err=>{clearTimeout(seekTimer);video.removeEventListener('seeked',seekDone);signal?.removeEventListener('abort',abortSeek);err?reject(err):resolve();};
   seekDone=()=>finish();abortSeek=()=>finish(cancelError());video.addEventListener('seeked',seekDone,{once:true});signal?.addEventListener('abort',abortSeek,{once:true});seekTimer=setTimeout(()=>finish(Error('Не удалось перейти к началу фрагмента')),8000);video.currentTime=range.start;
  });
  if(signal?.aborted||document.hidden)throw cancelError();
  ctx.drawImage(video,0,0,canvas.width,canvas.height);stream=canvas.captureStream(25);
  rec=new MediaRecorder(stream,{mimeType:format.type,videoBitsPerSecond:2500000});
  return await new Promise((resolve,reject)=>{
   let error=null,settled=false;const stop=(err=null)=>{if(settled||stopping)return;stopping=true;error=err;cancelAnimationFrame(frame);video.pause();if(rec.state!=='inactive')rec.stop();else done();};
   const abort=()=>stop(cancelError()),hidden=()=>{if(document.hidden)abort();};
   const done=()=>{if(settled)return;settled=true;clearTimeout(timer);cancelAnimationFrame(frame);signal?.removeEventListener('abort',abort);document.removeEventListener('visibilitychange',hidden);video.removeEventListener('error',failed);video.removeEventListener('ended',ended);if(error)return reject(error);if(!size)return reject(Error('Браузер не создал видеофрагмент'));resolve({blob:new Blob(chunks,{type:rec.mimeType||format.type}),extension:format.extension});};
   const failed=()=>stop(Error('Ошибка воспроизведения видео')),ended=()=>stop(video.currentTime>=range.end-.25?null:Error('Видео закончилось раньше выбранного времени'));
   rec.ondataavailable=e=>{if(!e.data?.size)return;size+=e.data.size;if(size>24*1024*1024){stop(Error('Фрагмент слишком большой'));return;}chunks.push(e.data);};
   rec.onerror=()=>stop(Error('Браузер не смог записать видео'));rec.onstop=done;
   signal?.addEventListener('abort',abort,{once:true});document.addEventListener('visibilitychange',hidden);video.addEventListener('error',failed);video.addEventListener('ended',ended);
   function draw(){if(stopping)return;try{if(video.currentTime>=range.end){onProgress(1);stop();return;}ctx.drawImage(video,0,0,canvas.width,canvas.height);onProgress(Math.max(0,Math.min(1,(video.currentTime-range.start)/range.seconds)));frame=requestAnimationFrame(draw);}catch(e){stop(e);}}
   timer=setTimeout(()=>stop(Error('Экспорт остановлен: видео не воспроизводится с нужной скоростью')),Math.ceil((range.seconds+12)*1000));
   try{rec.start(250);Promise.resolve(video.play()).then(()=>{if(!stopping)draw();}).catch(e=>stop(Error('Не удалось начать воспроизведение: '+e.message)));}catch(e){stop(e);}
  });
 }finally{
  clearTimeout(timer);clearTimeout(seekTimer);cancelAnimationFrame(frame);if(rec&&rec.state!=='inactive')try{rec.stop();}catch{}stream?.getTracks().forEach(t=>t.stop());video.pause();video.muted=previous.muted;video.playbackRate=previous.rate;
  if(video.readyState>0)try{video.currentTime=Math.min(previous.time,video.duration);}catch{}
 }
}
