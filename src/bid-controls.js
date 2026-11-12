// Keep every option reachable by touch, wheel, Tab and arrow/Home/End keys.
export function bindBidControls(root) {
  if(!root)return;
  const buttons=[...root.querySelectorAll('[data-bid]')];
  const update=()=>{
    const rows=innerHeight>540 && buttons.length*50>root.clientWidth ? 2 : 1;
    root.style.setProperty('--bid-columns',String(Math.ceil(buttons.length/rows)));
    root.dataset.before=String(root.scrollLeft>2);
    root.dataset.after=String(root.scrollLeft+root.clientWidth<root.scrollWidth-2);
  };
  root.addEventListener('scroll',update,{passive:true});
  root.addEventListener('wheel',event=>{
    if(Math.abs(event.deltaX)>=Math.abs(event.deltaY) || root.scrollWidth<=root.clientWidth)return;
    const before=root.scrollLeft;
    root.scrollLeft+=event.deltaY*(event.deltaMode===1?20:event.deltaMode===2?root.clientWidth:1);
    if(root.scrollLeft!==before)event.preventDefault();
  },{passive:false});
  root.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const available=buttons.filter(button=>!button.disabled);
    const index=available.indexOf(event.target);if(index<0)return;
    const next=event.key==='Home'?0:event.key==='End'?available.length-1:Math.max(0,Math.min(available.length-1,index+(event.key==='ArrowRight'?1:-1)));
    event.preventDefault();available[next].focus({preventScroll:true});available[next].scrollIntoView({block:'nearest',inline:'nearest'});
  });
  root.addEventListener('focusin',event=>event.target.scrollIntoView({block:'nearest',inline:'nearest'}));
  const observer=new ResizeObserver(update);observer.observe(root);
  // The renderer replaces the group on every state transition.
  window.addEventListener('resize',update);
  root._disposeBidControls=()=>{observer.disconnect();window.removeEventListener('resize',update);};
  update();
}
