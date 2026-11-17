interface Window {
  L: any;
  __TRAILVIEWER_RUNTIME_CONFIG__?: {
    tiandituKey?: string;
    direct?: boolean;
    customSources?: Array<Record<string, unknown>>;
  };
  trailViewer?: any;
  gpxViewer?: any;
  chrome?: {
    webview?: {
      postMessage(message: string): void;
      addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
    };
  };
}
