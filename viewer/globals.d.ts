interface Window {
  L: any;
  gpxViewer?: any;
  chrome?: {
    webview?: {
      postMessage(message: string): void;
    };
  };
}
