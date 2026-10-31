// Only public lifecycle fields are used, so players and spectators see the same wait.
export function turnStatus(state, { now = Date.now(), connected = true } = {}) {
  const life = state.lifecycle ?? {};
  const seconds = ms => Math.max(0, Math.ceil(ms / 1000));
  if (life.paused) return { text: `暂停 · ${seconds(life.remainingMs || 0)} 秒`, urgent: false };
  if (!connected) return { text: '连接恢复中', urgent: false };
  if (life.reconnecting) {
    const name = state.players.find(player => player.id === life.reconnectPlayerId)?.name ?? state.players[state.turn]?.name ?? '当前玩家';
    const wait = Number.isFinite(life.reconnectUntil) ? seconds(life.reconnectUntil - now) : seconds(life.reconnectRemainingMs || 0);
    return { text: `断线等待 ${wait} 秒`, label: `${name} 断线，等待重连 ${wait} 秒`, urgent: false };
  }
  if (!Number.isFinite(state.turnDeadline)) return { text: '同步中', urgent: false };
  const remaining = seconds(state.turnDeadline - now);
  return { text: `${remaining} 秒`, label: `当前玩家剩余出牌时间 ${remaining} 秒`, urgent: remaining <= 10 };
}
