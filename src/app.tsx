import { Rail } from './components/Rail';
import { engine } from './engine/install';
import { useRoute } from './lib/router';
import { useStore } from './lib/store';
import { DatasetView } from './screens/DatasetView';
import { Datasets } from './screens/Datasets';
import { EnginePage } from './screens/EnginePage';
import { History } from './screens/History';
import { Install } from './screens/Install';
import { Licences } from './screens/Licences';
import { RunView } from './screens/RunView';

export function App() {
  const route = useRoute();
  const status = useStore(engine);
  const [section, id] = route;

  if (status.phase === 'checking') {
    return <div class="splash">Looking for the engine on this device…</div>;
  }
  // Until the engine is installed, only the install screen and the licences are shown.
  const installed =
    !['absent', 'installing', 'unsupported'].includes(status.phase) && !status.justInstalled;
  if (!installed && section !== 'licences') return <Install />;

  let page;
  let current = 'datasets';
  if (section === 'dataset' && id) page = <DatasetView key={id} id={id} />;
  else if (section === 'run' && id) page = <RunView key={id} id={id} />;
  else if (section === 'runs') [page, current] = [<History />, 'runs'];
  else if (section === 'engine') [page, current] = [<EnginePage />, 'engine'];
  else if (section === 'licences') [page, current] = [<Licences />, 'licences'];
  else if (!section) page = <Datasets />;
  else {
    page = (
      <div class="empty">
        <strong>There is no page at this address</strong>
        <a href="#/">Go to your datasets</a>
      </div>
    );
  }

  if (!installed) return <main class="main">{page}</main>;
  return (
    <div class="shell">
      <Rail current={current} />
      <main class="main">
        {status.phase === 'failed' && section !== 'engine' && (
          <div class="notice bad" role="alert">
            <strong>Rama's ML Engine could not start on this device</strong>
            {status.error} <a href="#/engine">Open the engine page</a> to try again or remove it.
          </div>
        )}
        {page}
      </main>
    </div>
  );
}
