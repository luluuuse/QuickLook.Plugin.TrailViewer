interface Window {
  L: any;
  trailViewer?: any;
  gpxViewer?: any;
  chrome?: {
    webview?: {
      postMessage(message: string): void;
    };
  };
}
