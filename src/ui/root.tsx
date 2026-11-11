import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { HomeScreen, RoomHeading, LobbyScreen, LobbyStart } from './entry';
import { TableScreen, HandTools } from './table';
import { RulesModal } from './rules-modal';
import { QuickSettings, RulesButton, LobbyOperations, GameToolbar, GameMenu, Lifecycle } from './chrome';
import { useUIModel, publish, patchDraft } from './store';
import type { UIModel, RoomModel } from './types';
import './theme.css';

function Interface() {
  const model = useUIModel(), room = model as RoomModel;
  const lobby = model.state?.phase === 'lobby';
  return <>
    <div className="page" key={model.renderEpoch}>
      {!model.state ? <HomeScreen model={model}/> : null}
      {(!model.state || lobby) && <header className={`topbar ${!model.state ? 'home-tools' : ''}`}>
        {lobby && <a className="brand" href={location.pathname}><span className="brand-icon">✦</span><span>巫师牌<small>WIZARD / FRIENDS TABLE</small></span></a>}
        <div className="top-actions">
          {!model.domestic && <button type="button" className="text-button" data-safety-notice="">隐私 / 举报</button>}
          {!model.state && <RulesButton/>}<QuickSettings model={model}/>
        </div>
        {lobby && <><LobbyStart model={room}/><span className="control-host" data-chat-host=""/></>}
      </header>}
      {model.state && (lobby ? <>
        <RoomHeading model={room}><LobbyOperations model={room}/><Lifecycle model={room}/></RoomHeading><LobbyScreen model={room}/>
      </> : <>
        <TableScreen model={room}/><GameToolbar model={room}/><HandTools model={room}/><GameMenu model={room}/><Lifecycle model={room}/>
      </>)}
      {model.spectating && <div className="spectator-banner">观战中 · 仅公开信息 · {model.state?.spectatorCount || 0} 人观战</div>}
    </div>
    <div id="notice" className="notice" role="status" aria-live="polite">{model.status}</div>
    {model.rulesOpen && <RulesModal/>}
  </>;
}

let root: ReturnType<typeof createRoot> | undefined;
/** Synchronous boundary lets retained scene/layout adapters observe committed DOM. */
export function renderUI(model: UIModel) {
  if (!root) { publish(model); root = createRoot(document.getElementById('app')!); }
  flushSync(() => { publish(model); root!.render(<Interface/>); });
}
export function updateUIDraft(patch: Partial<UIModel>) { flushSync(() => patchDraft(patch)); }
