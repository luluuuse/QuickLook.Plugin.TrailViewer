interface Window {
  L: any;
  __TRAILVIEWER_RUNTIME_CONFIG__?: {
    tiandituKey?: string;
    direct?: boolean;
    customSources?: Array<Record<string, unknown>>;
    tileCache?: {
      enabled?: boolean;
      maxMb?: number;
      maxAgeDays?: number;
    };
  };
  trailViewer?: any;
  chrome?: {
    webview?: {
      postMessage(message: string): void;
      addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
    };
  };
}
