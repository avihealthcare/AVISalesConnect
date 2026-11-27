import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';
import { AviIcon } from './AviIcon';
import { LeadDialog, LeadForm } from './LeadEditor';
import { commandError, type Workspace } from './leadModel';
import { cardAccept, cardFileLimit, sendCardImages, type CardFields, type CardMatches, type CardUpload, type MatchInputs } from './visitingCardModel';

type Side = 'front' | 'back';
type Crop = Record<'left' | 'top' | 'right' | 'bottom', number>;
type CardImage = { file: File; image: HTMLImageElement; turns: number; crop: Crop };
const emptyCrop: Crop = { left:0,top:0,right:0,bottom:0 };
const emptyMatch = { customer:'',mobile:'',alternate_mobile:'',email:'' };
const sideTitle = { front:'Front side',back:'Back side' };

async function decode(file: File) {
  const load = async (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally { URL.revokeObjectURL(url); }
  };
  try { return await load(file); }
  catch (error) {
    if (!/hei[cf]/i.test(file.type) && !/\.hei[cf]$/i.test(file.name)) throw error;
    const { heicTo } = await import('heic-to/csp');
    return load(await heicTo({ blob:file, type:'image/jpeg', quality:0.94 }));
  }
}

function draw(canvas: HTMLCanvasElement, card: CardImage, limit = 1600) {
  const { image, turns, crop } = card;
  const width = image.naturalWidth * (100 - crop.left - crop.right) / 100;
  const height = image.naturalHeight * (100 - crop.top - crop.bottom) / 100;
  const scale = Math.min(1, limit / Math.max(width,height));
  const outputWidth = Math.max(1,Math.round(width*scale));
  const outputHeight = Math.max(1,Math.round(height*scale));
  canvas.width = turns % 2 ? outputHeight : outputWidth;
  canvas.height = turns % 2 ? outputWidth : outputHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image previews are unavailable in this browser.');
  context.fillStyle = '#fff';
  context.fillRect(0,0,canvas.width,canvas.height);
  context.translate(canvas.width/2, canvas.height/2);
  context.rotate(turns * Math.PI/2);
  context.drawImage(image,image.naturalWidth*crop.left/100,image.naturalHeight*crop.top/100,width,height,
    -outputWidth/2,-outputHeight/2,outputWidth,outputHeight);
}
function jpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve,reject) => canvas.toBlob(blob =>
    blob ? resolve(blob) : reject(new Error('Could not prepare this photo.')), 'image/jpeg', 0.89));
}
function preparedImage(card: CardImage) {
  const canvas = document.createElement('canvas');
  draw(canvas,card);
  return jpeg(canvas);
}

function CardPreview({ card, name, busy, zoom = 1 }: { card:CardImage;name:string;busy?:boolean;zoom?:number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (canvas.current) draw(canvas.current,card); },[card]);
  return <div className="avi-card-preview" data-zoom={zoom}>
    <canvas ref={canvas} role="img" aria-label={name}/>
    {busy && <div className="avi-card-scan-overlay"><span>Extracting contact &amp; hospital details…</span></div>}
  </div>;
}

function CardSide({ side, card, choose, change, camera, remove, disabled, unavailable }: {
  side:Side; card:CardImage|undefined; choose:(file:File)=>void; change:(card:CardImage)=>void;
  camera:()=>void; remove:()=>void; disabled:boolean; unavailable:boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const capture = useRef<HTMLInputElement>(null);
  const [drag,setDrag] = useState(false);
  const [cropOpen,setCropOpen] = useState(false);
  const title = sideTitle[side];
  const useCamera = () => {
    if (matchMedia('(pointer: coarse)').matches || !navigator.mediaDevices?.getUserMedia) capture.current?.click();
    else camera();
  };
  return <section className="avi-card-side" aria-label={title}>
    <div className="card-heading"><h3>{title}</h3><small className="muted">{side==='front'?'Required':'Optional'}</small></div>
    <input ref={input} type="file" accept={cardAccept} hidden aria-label={`Choose ${title.toLowerCase()} image`} disabled={disabled}
      onChange={event=>{const file=event.target.files?.[0];if(file) choose(file);event.target.value='';}}/>
    <input ref={capture} type="file" accept="image/*" capture="environment" hidden aria-label={`Capture ${title.toLowerCase()}`} disabled={disabled}
      onChange={event=>{const file=event.target.files?.[0];if(file) choose(file);event.target.value='';}}/>
    <div className="avi-card-drop" data-drag={drag} data-preview={!!card}
      onDragOver={event=>{event.preventDefault();if(!disabled)setDrag(true);}}
      onDragLeave={()=>setDrag(false)} onDrop={event=>{
        event.preventDefault();setDrag(false);const file=event.dataTransfer.files[0];if(file&&!disabled)choose(file);
      }}>
      {card ? <CardPreview card={card} name={`${title} preview`} busy={unavailable}/> : <>
        <span className="avi-card-drop-icon"><AviIcon name="upload" size={22}/></span>
        <strong>Drop an image or choose a file</strong>
        <small className="muted">JPG, PNG, WEBP or HEIC · up to 10 MB</small>
        <button type="button" className="secondary" onClick={()=>input.current?.click()} disabled={disabled}>Choose image</button>
      </>}
    </div>
    <div className="avi-card-tools">
      <button type="button" className="secondary avi-with-icon" onClick={useCamera} disabled={disabled}><AviIcon name="camera"/>{card?'Retake':'Use Camera'}</button>
      {card && <>
        <button type="button" className="secondary" disabled={disabled} onClick={()=>change({...card,turns:(card.turns+1)%4})}>Rotate 90°</button>
        <button type="button" className="secondary" disabled={disabled} aria-expanded={cropOpen} onClick={()=>setCropOpen(!cropOpen)}>Crop</button>
        <button type="button" className="secondary" disabled={disabled} onClick={()=>{setCropOpen(false);remove();}}>Remove</button>
      </>}
    </div>
    {card && cropOpen && <fieldset className="avi-card-crop" disabled={disabled}><legend>Trim the original edges</legend>
      {(Object.keys(emptyCrop) as (keyof Crop)[]).map(edge=><label key={edge}>{edge}<input type="range" min="0" max="40"
        value={card.crop[edge]} onChange={event=>change({...card,crop:{...card.crop,[edge]:Number(event.target.value)}})}/></label>)}
      <button className="secondary" type="button" onClick={()=>change({...card,crop:emptyCrop})}>Reset crop</button>
    </fieldset>}
  </section>;
}

function Camera({ side, capture, cancel }: { side:Side;capture:(file:File)=>void;cancel:()=>void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready,setReady] = useState(false);
  const [capturing,setCapturing] = useState(false);
  const [error,setError] = useState('');
  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled=false;
    navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false}).then(result=>{
      if (cancelled) { result.getTracks().forEach(track=>track.stop());return; }
      stream=result;
      if(video.current) video.current.srcObject=result;
    }).catch(()=>{if(!cancelled)setError('Camera access is unavailable. Choose an image instead.');});
    return ()=>{cancelled=true;stream?.getTracks().forEach(track=>track.stop());};
  },[]);
  async function takePicture() {
    const source=video.current;
    if (!source?.videoWidth || capturing) return;
    setCapturing(true);
    try {
      const canvas=document.createElement('canvas');
      canvas.width=source.videoWidth;
      canvas.height=source.videoHeight;
      const context=canvas.getContext('2d');
      if (!context) throw new Error();
      context.drawImage(source,0,0);
      capture(new File([await jpeg(canvas)],`${side}-card.jpg`,{type:'image/jpeg'}));
    } catch {setError('Unable to capture the photo. Try again or choose an image.');setCapturing(false);}
  }
  return <section className="avi-card-camera" aria-label={`Camera for ${sideTitle[side].toLowerCase()}`}>
    {!error && <video ref={video} autoPlay playsInline muted onCanPlay={()=>setReady(true)}/>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="avi-card-tools">
      <button type="button" className="secondary" onClick={cancel}>Close camera</button>
      {!error && <button type="button" disabled={!ready||capturing} onClick={()=>void takePicture()}>Take photo</button>}
    </div>
  </section>;
}

export function VisitingCardScanner({ db, organization, workspace, close, saved }: {
  db:SupabaseClient<Database>;organization:string;workspace:Workspace;close:()=>void;
  saved:(result:{id:string;number:string}, another:boolean, documents:boolean)=>void;
}) {
  const [images,setImages] = useState<Partial<Record<Side,CardImage>>>({});
  const [addBack,setAddBack] = useState(false);
  const [camera,setCamera] = useState<Side>();
  const [working,setWorking] = useState<'decode'|'extract'|'save'>();
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [fields,setFields] = useState<CardFields>();
  const [inputs,setInputs] = useState<MatchInputs>(emptyMatch);
  const [matches,setMatches] = useState<CardMatches>();
  const [checking,setChecking] = useState(false);
  const [matchError,setMatchError] = useState(false);
  const [preview,setPreview] = useState<Side>('front');
  const [zoom,setZoom] = useState(1);
  const active = useRef(false);
  const upload = useRef<CardUpload | undefined>(undefined);
  const receipt = useRef<{request:string;key:string} | undefined>(undefined);
  const step = useRef<HTMLHeadingElement>(null);
  const review = fields !== undefined;

  useEffect(()=>{step.current?.focus();},[review]);
  useEffect(()=>{
    setMatches(undefined);setMatchError(false);setChecking(false);
    if(!review||!Object.values(inputs).some(value=>value.trim().length>=4))return;
    let current=true;
    setChecking(true);
    const timer=window.setTimeout(()=>{
      void db.rpc('find_card_matches',{p_org:organization,p_hospital:inputs.customer,p_phone:inputs.mobile,
        p_secondary:inputs.alternate_mobile,p_email:inputs.email}).then(result=>{
        if(!current)return;
        setChecking(false);
        if(result.error)setMatchError(true);
        else setMatches(result.data as unknown as CardMatches);
      });
    },220);
    return ()=>{current=false;window.clearTimeout(timer);};
  },[db,organization,inputs,review]);

  async function choose(side:Side,file:File) {
    if(active.current)return;
    setError('');setNotice('');
    if(!file.size||file.size>cardFileLimit) {setError('Choose an image up to 10 MB.');return;}
    if(!/^image\/(jpeg|png|webp|hei[cf])$/i.test(file.type)&&!/\.(jpe?g|png|webp|hei[cf])$/i.test(file.name)) {
      setError('Choose a JPG, PNG, WEBP or HEIC image.');return;
    }
    active.current=true;setWorking('decode');
    try {
      const image=await decode(file);
      setImages(previous=>({...previous,[side]:{file,image,turns:0,crop:emptyCrop}}));
      upload.current=undefined;
    } catch {setError('This image could not be opened. Retake the photo or choose a different image.');}
    finally {active.current=false;setWorking(undefined);}
  }

  function startReview(result:CardFields) {
    setError('');
    setFields(result);
    setInputs({customer:result.customer?.value??'',mobile:result.mobile?.value??'',
      alternate_mobile:result.alternate_mobile?.value??'',email:result.email?.value??''});
    setPreview('front');setZoom(1);
  }

  async function extract() {
    if(active.current||!images.front)return;
    active.current=true;setWorking('extract');setError('');setNotice('');
    try {
      const front=await preparedImage(images.front);
      const back=addBack&&images.back ? await preparedImage(images.back) : undefined;
      const result=await sendCardImages<{fields:CardFields}>(db,organization,'extract',front,back);
      startReview(result.fields);
    } catch (failure) {setError(failure instanceof Error?failure.message:'This card could not be read. Enter the details manually.');}
    finally {active.current=false;setWorking(undefined);}
  }

  async function save(input:Json,another=false) {
    if(active.current||!images.front||!input||typeof input!=='object'||Array.isArray(input))return;
    active.current=true;setWorking('save');setError('');
    try {
      upload.current ??= await sendCardImages<CardUpload>(db,organization,'upload',images.front.file,addBack?images.back?.file:undefined);
      const {open_documents,...lead}=input;
      const body={...lead,...upload.current};
      const request=JSON.stringify(body);
      if(receipt.current?.request!==request) receipt.current={request,key:crypto.randomUUID()};
      const result=await db.rpc('create_card_lead',{p_org:organization,p_key:receipt.current.key,p_input:body});
      if(result.error)throw new Error(commandError(result.error));
      const record=result.data as {id:string;number:string};
      upload.current=undefined;receipt.current=undefined;
      saved(record,another,Boolean(open_documents));
      if(another) {
        setImages({});setAddBack(false);setFields(undefined);setInputs(emptyMatch);
        setNotice(`${record.number} saved. Add the next card.`);
      }
    } catch (failure) {setError(failure instanceof Error?failure.message:'Unable to save the lead. Try again.');}
    finally {active.current=false;setWorking(undefined);}
  }

  const requestClose=()=>{if(!active.current)close();};
  const update=(side:Side,card?:CardImage)=>setImages(current=>({...current,[side]:card}));
  const renderSide=(side:Side)=><CardSide side={side} card={images[side]} choose={file=>void choose(side,file)}
    change={card=>update(side,card)} remove={()=>{update(side);upload.current=undefined;}} camera={()=>setCamera(side)}
    disabled={!!working||!!camera} unavailable={working==='extract'}/>;

  return <LeadDialog title="Scan Visiting Card" className={`avi-card-dialog ${review?'avi-card-review':''}`} onClose={requestClose}>
    <div className="avi-card-steps"><h3 ref={step} tabIndex={-1}>{review?'2. Verify details':'1. Capture or upload'}</h3>
      <span className="muted">{review?'Review the card before creating a lead.':'Auto-fill hospital, doctor & contact details via AI'}</span>
    </div>
    {notice&&<p className="avi-card-notice" role="status">{notice}</p>}
    {!review ? <div className="avi-card-capture">
      <div className="avi-card-sides">{renderSide('front')}{addBack&&renderSide('back')}</div>
      {camera&&<Camera side={camera} capture={file=>{setCamera(undefined);void choose(camera,file);}} cancel={()=>setCamera(undefined)}/>}
      <label className="lead-check"><input type="checkbox" checked={addBack} disabled={!!working||!!camera}
        onChange={event=>{setAddBack(event.target.checked);upload.current=undefined;}}/> Add Back Side</label>
      {working==='decode'&&<p role="status" className="muted">Preparing image…</p>}
      {working==='extract'&&<p className="avi-sr-only" role="status">Extracting contact and hospital details</p>}
      {error&&<p className="error" role="alert">{error}</p>}
      <p className="muted">Extract Details sends an image to the AI service. Saving keeps the original card with the lead.</p>
      <div className="lead-form-actions">
        <button type="button" className="secondary" disabled={!!working||!!camera||!images.front} onClick={()=>startReview({})}>Enter Details Manually</button>
        <button type="button" disabled={!!working||!!camera||!images.front} onClick={()=>void extract()}>
          {working==='extract'?'Extracting…':'Extract Details'}
        </button>
      </div>
    </div> : <div className="avi-card-review-grid">
      <aside className="avi-card-reference" aria-label="Reference images">
        <div className="card-heading"><h3>Visiting card</h3>
          <button type="button" className="link" disabled={!!working} onClick={()=>{
            setFields(undefined);setError('');setNotice('');
          }}>Change images</button></div>
        {addBack&&images.back&&<div className="avi-card-tools">{(['front','back'] as const).map(side=>
          <button key={side} type="button" className="secondary" aria-pressed={preview===side} onClick={()=>setPreview(side)}>{sideTitle[side]}</button>)}</div>}
        {images[preview]&&<CardPreview card={images[preview]} name={`${sideTitle[preview]} reference`} zoom={zoom}/>}
        <div className="avi-card-tools">
          <label>Zoom <input type="range" min="1" max="3" step="1" value={zoom} onChange={event=>setZoom(Number(event.target.value))}/></label>
          <button className="secondary" type="button" onClick={()=>{
            const card=images[preview];if(card)update(preview,{...card,turns:(card.turns+1)%4});
          }}>Rotate 90°</button>
        </div>
      </aside>
      <LeadForm workspace={workspace} save={save} onClose={requestClose} busy={working==='save'} error={error}
        card={{fields,matches,checking,matchError,onMatchInput:setInputs}}/>
    </div>}
  </LeadDialog>;
}
