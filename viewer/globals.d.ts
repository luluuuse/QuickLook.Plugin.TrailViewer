interface Window {
  L: any;
  __TRAILVIEWER_RUNTIME_CONFIG__?: {
    tiandituKey?: string;
    direct?: boolean;
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
