// Derive waiting state from the public projection, including spectators.
// bidSubmitted is deliberately independent of hidden bid values.
export function bidStatus(state, playerId, {connected=true}={}) {
  if(state?.phase!=='bid')return '';
  const player=state.players.find(p=>p.id===playerId);
  if(!player)return '';
  if(player.bidSubmitted || Number.isInteger(player.bid))return 'submitted';
  const active=(state.options?.predictionMode ?? 'public')!=='public' || state.players[state.turn]?.id===playerId;
  if(!active)return '';
  return connected && !state.lifecycle?.paused && !state.lifecycle?.reconnecting && !state.lifecycle?.continuationVote ? 'waiting' : 'held';
}
export function bidPrompt(state, playerId) {
  if(state.canBid)return '请预测';
  const pending=state.players.filter(p=>bidStatus(state,p.id)==='waiting' || bidStatus(state,p.id)==='held');
  if((state.options?.predictionMode ?? 'public')!=='public')return pending.length ? '等待尚未提交的玩家预测' : '预测已提交';
  return pending[0] ? `等待 ${pending[0].name} 预测` : '等待预测';
}
