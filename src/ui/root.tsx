import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { HomeScreen, JoinRoomModal, RoomHeading, LobbyScreen, LobbyStart } from './entry';
import { TableScreen, HandTools } from './table';
import { RulesModal } from './rules-modal';
import { QuickSettings, RulesButton, LobbyOperations, GameToolbar, GameMenu, Lifecycle, LobbyNavigation, LobbyReturnModal } from './chrome';
import { useUIModel, publish, patchDraft } from './store';
import type { UIModel, RoomModel } from './types';
import './theme.css';
import '../home-dock.css';

function Interface() {
  const model = useUIModel(), room = model as RoomModel;
  const lobby = model.state?.phase === 'lobby';
  return <>
    <LobbyNavigation model={model}/>
    <div className="page" key={model.renderEpoch}>
      {(!model.state || lobby) && <header className={`topbar ${!model.state ? 'home-tools' : ''}`}>
        {!model.state && <div className="home-brand"><h1>巫师牌</h1><small>{model.domestic ? '国内站' : '海外站'}</small></div>}
        {lobby && <a className="brand" href={location.pathname}><span className="brand-icon">✦</span><span>巫师牌<small>WIZARD / FRIENDS TABLE</small></span></a>}
        <div className="top-actions">
          {model.state && !model.domestic && <button type="button" className="text-button" data-safety-notice="">隐私 / 举报</button>}
          {!model.state && <RulesButton/>}<QuickSettings model={model}/>
        </div>
        {lobby && <><LobbyStart model={room}/><span className="control-host" data-chat-host=""/></>}
      </header>}
      {!model.state ? <HomeScreen model={model}/> : null}
      {model.state && (lobby ? <>
        <RoomHeading model={room}><LobbyOperations model={room}/><Lifecycle model={room}/></RoomHeading><LobbyScreen model={room}/>
      </> : <>
        <TableScreen model={room}/><GameToolbar model={room}/><HandTools model={room}/><GameMenu model={room}/><Lifecycle model={room}/>
      </>)}
      {model.spectating && <div className="spectator-banner">观战中 · 仅公开信息 · {model.state?.spectatorCount || 0} 人观战</div>}
    </div>
    <div id="notice" className="notice" role="status" aria-live="polite">{model.status}</div>
    {!model.state && model.joinOpen && !model.rulesOpen && <JoinRoomModal model={model}/>}
    {model.rulesOpen && <RulesModal/>}
    {model.lobbyReturnText && <LobbyReturnModal message={model.lobbyReturnText}/>}
  </>;
}

let root: ReturnType<typeof createRoot> | undefined;
/** Synchronous boundary lets retained scene/layout adapters observe committed DOM. */
export function renderUI(model: UIModel) {
  if (!root) { publish(model); root = createRoot(document.getElementById('app')!); }
  flushSync(() => { publish(model); root!.render(<Interface/>); });
}
export function updateUIDraft(patch: Partial<UIModel>) { flushSync(() => patchDraft(patch)); }
