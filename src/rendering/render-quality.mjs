import { LinearFilter, LinearMipmapLinearFilter } from 'three';

// Native-density high quality is restricted to phone-sized touch screens. Use
// stable screen dimensions, not the table/visual viewport or a keyboard resize.
export function isPhoneRenderTarget({coarse=false,width=0,height=0}={}) {
  return coarse && width>0 && height>0 && Math.min(width,height)<=480;
}
export const HIGH_QUALITY_DPR = 3;
export const PHONE_PIXEL_BUDGET = 4_000_000;
export function drawingBufferPlan({width,height,devicePixelRatio=1,low=false,phone=false,maxDimension=Infinity}) {
  if (!(width>0 && height>0) || !Number.isFinite(width*height)) return null;
  const native=Number.isFinite(devicePixelRatio)&&devicePixelRatio>0?devicePixelRatio:1;
  const hardware=Number.isFinite(maxDimension)&&maxDimension>0?maxDimension:Infinity;
  // No frame-rate input, persisted setting, or desktop/tablet policy change.
  const highPhone=phone&&!low;
  const ratio=Math.min(native,highPhone?HIGH_QUALITY_DPR:2,
    highPhone?Math.sqrt(PHONE_PIXEL_BUDGET/(width*height)):Infinity,
    highPhone?hardware/Math.max(width,height):Infinity);
  return {width,height,ratio,bufferWidth:Math.floor(width*ratio),bufferHeight:Math.floor(height*ratio)};
}

const buffers=new WeakMap();
export function updateDrawingBuffer(renderer,options) {
  const next=drawingBufferPlan(options);
  if(!next)return false;
  const previous=buffers.get(renderer);
  if(previous?.width===next.width && previous.height===next.height && previous.ratio===next.ratio)return false;
  // setPixelRatio() resizes at the old CSS size before a second setSize(). The
  // atomic API updates dimensions and density once, without changing CSS layout.
  renderer.setDrawingBufferSize(next.width,next.height,next.ratio);
  buffers.set(renderer,next);
  return true;
}

export function configureCardSampling(texture,{low=false,phone=false,maxAnisotropy=1}={}) {
  const maximum=Number.isFinite(maxAnisotropy)?Math.max(1,maxAnisotropy):1;
  const settings={minFilter:LinearMipmapLinearFilter,magFilter:LinearFilter,generateMipmaps:true,
    anisotropy:Math.min(phone&&!low?8:4,maximum)};
  let changed=false;
  for(const [name,value]of Object.entries(settings))if(texture[name]!==value){texture[name]=value;changed=true;}
  // Keep trilinear mipmaps, never nearest filtering or a negative LOD bias.
  // Sharper oblique sampling must not trade away stable edges during motion.
  if(changed)texture.needsUpdate=true;
  return changed;
}
