// A single compact preview follows the actual trigger, even when the toolbar
// reparents it. Never solve a collision by moving the message across the table.
export function anchorChatPreview(preview, trigger, obstacles=[]) {
  if(!preview?.firstElementChild || !trigger?.isConnected || !trigger.getClientRects().length)return;
  const viewport=visualViewport,style=getComputedStyle(preview);
  const pad=edge=>Math.max(8,parseFloat(style.getPropertyValue(`--chat-safe-${edge}`))||0);
  const left=(viewport?.offsetLeft||0)+pad('left'),top=(viewport?.offsetTop||0)+pad('top');
  const right=(viewport?.offsetLeft||0)+(viewport?.width||innerWidth)-pad('right'),bottom=(viewport?.offsetTop||0)+(viewport?.height||innerHeight)-pad('bottom');
  const anchor=trigger.getBoundingClientRect();
  preview.style.width=`${Math.min(236,right-left)}px`;
  const {width,height}=preview.getBoundingClientRect(), gap=10;
  const clampX=x=>Math.max(left,Math.min(right-width,x));
  const candidates=[
    [anchor.left-width-gap,anchor.top], [anchor.right+gap,anchor.top],
    [clampX(anchor.right-width),anchor.bottom+gap], [clampX(anchor.left),anchor.bottom+gap],
    [anchor.left-width-gap,anchor.bottom+gap], [anchor.right+gap,anchor.bottom+gap],
    [clampX(anchor.right-width),anchor.top-height-gap], [clampX(anchor.left),anchor.top-height-gap],
  ];
  const blocked=obstacles.filter(node=>node?.getClientRects().length).map(node=>node.getBoundingClientRect());
  // Compact tables place a public player strip directly under the toolbar.
  // Try the next clear edge within the same local region before suppressing.
  for(const r of blocked)if(r.bottom>=anchor.bottom&&r.bottom<anchor.bottom+100) {
    candidates.push([clampX(anchor.right-width),r.bottom+gap],[clampX(anchor.left),r.bottom+gap],[anchor.left-width-gap,r.bottom+gap]);
  }
  const chosen=candidates.find(([x,y])=>x>=left&&x+width<=right&&y>=top&&y+height<=bottom && !blocked.some(r=>x<r.right+4&&x+width>r.left-4&&y<r.bottom+4&&y+height>r.top-4));
  preview.style.visibility=chosen?'visible':'hidden';
  if(chosen){preview.style.left=`${chosen[0]}px`;preview.style.top=`${chosen[1]}px`;}
}
