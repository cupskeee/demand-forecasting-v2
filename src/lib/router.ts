import { useEffect, useState } from 'preact/hooks';

const read = () => location.hash.replace(/^#/, '') || '/';

/** The current route, kept in the address bar's hash so it works on static hosting. */
export function useRoute(): string[] {
  const [path, setPath] = useState(read());
  useEffect(() => {
    const onChange = () => {
      setPath(read());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return path.split('/').filter(Boolean);
}

export function navigate(path: string) {
  location.hash = path;
}
