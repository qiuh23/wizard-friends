import { backendId, publicRoomCode, isDomestic } from './backend-entry.js';
export function safetyNoticeHTML() { if(isDomestic()) return ''; return '<button type="button" class="text-button" data-safety-notice>隐私 / 举报</button>'; }
export async function showSafetyNotice(room='') {
  if(isDomestic()) return;
  let dialog=document.querySelector('#safety-notice');
  if(!dialog) {
    dialog=document.createElement('dialog');dialog.id='safety-notice';dialog.className='safety-notice';
    const title=document.createElement('h2');title.textContent='隐私与举报';
    const text=document.createElement('p');text.textContent='浏览器保存房间恢复凭据。服务器为联机和安全处置保存房间与成员标识、连接时间、来源 IP（可取得时）、操作类型和结果；网络及安全记录保存 200 天，处置原因和必要证据默认保存 90 天。依法保全的记录延长保存。不会把密码、令牌或手牌写入安全日志，也不采集身份证或设备指纹。';
    const chat=document.createElement('p');chat.textContent='普通聊天仅保留房间最近 100 条且最长 7 天，房间关闭后清除；站长处置时仅保存必要证据。举报请提供线路、房间码、消息编号、时间和原因，不要发送恢复凭据、证件或无关聊天。站长核实后可隐藏内容、限制成员或关闭房间。';
    const contact=document.createElement('p');contact.dataset.reportContact='';
    const close=document.createElement('button');close.textContent='关闭';close.onclick=()=>dialog.close();
    dialog.append(title,text,chat,contact,close);document.body.append(dialog);
  }
  const contact=dialog.querySelector('[data-report-contact]');contact.textContent='正在读取联系方式…';dialog.showModal();
  try {
    const response=await fetch('/api/security/contact',{cache:'no-store'});if(!response.ok)throw Error();
    const {contact:address}=await response.json();contact.replaceChildren();
    if(typeof address==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      const link=document.createElement('a');link.textContent=`举报 / 联系站长：${address}`;link.href=`mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(`巫师牌举报 ${backendId()} ${room?publicRoomCode(room):''}`)}`;contact.append(link);
    }else contact.textContent='公开联系方式待配置，请稍后查看。';
  }catch{contact.textContent='联系方式暂时无法读取，请稍后重试。';}
}
