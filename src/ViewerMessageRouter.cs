using System;

namespace QuickLook.Plugin.TrailViewer;

internal sealed class ViewerMessageActions
{
    internal Action<string> BeginExport { get; set; } = _ => { };
    internal Action<string> AppendExport { get; set; } = _ => { };
    internal Action<string> FinishExport { get; set; } = _ => { };
    internal Func<string, System.Threading.Tasks.Task> CopyToClipboard { get; set; } =
        _ => System.Threading.Tasks.Task.CompletedTask;
    internal Action<string> BeginAttachment { get; set; } = _ => { };
    internal Func<string, System.Threading.Tasks.Task> CopyLocalAttachment { get; set; } =
        _ => System.Threading.Tasks.Task.CompletedTask;
    internal Func<string, System.Threading.Tasks.Task> ResumeAttachments { get; set; } =
        _ => System.Threading.Tasks.Task.CompletedTask;
    internal Action<string> AppendAttachment { get; set; } = _ => { };
    internal Func<string, System.Threading.Tasks.Task> FinishAttachment { get; set; } =
        _ => System.Threading.Tasks.Task.CompletedTask;
    internal Func<string, System.Threading.Tasks.Task> DownloadAttachment { get; set; } =
        _ => System.Threading.Tasks.Task.CompletedTask;
    internal Action<string> Ready { get; set; } = _ => { };
    internal Action<string> Error { get; set; } = _ => { };
    internal Action<string> SaveSettings { get; set; } = _ => { };
    internal Action<string> SaveCustomSources { get; set; } = _ => { };
    internal Action<bool> MeasureState { get; set; } = _ => { };
    internal Action<bool> EditorState { get; set; } = _ => { };
    internal Action<bool> EditorDirty { get; set; } = _ => { };
    internal Action<string> TitleMeta { get; set; } = _ => { };
    internal Action<string> BeginTrackSave { get; set; } = _ => { };
    internal Action<string> AppendTrackSave { get; set; } = _ => { };
    internal Func<string, System.Threading.Tasks.Task> FinishTrackSave { get; set; } =
        _ => System.Threading.Tasks.Task.CompletedTask;
    internal Action<bool> TextInput { get; set; } = _ => { };
    internal Action<bool> TextComposing { get; set; } = _ => { };
    internal Action<string> ConfigureTiandituKey { get; set; } = _ => { };
    internal Action<string> RemoveTiandituKey { get; set; } = _ => { };
    internal Action RequestTileCacheStats { get; set; } = () => { };
    internal Action ClearTileCache { get; set; } = () => { };
    internal Func<string, System.Threading.Tasks.Task> ProbeNode { get; set; } =
        _ => System.Threading.Tasks.Task.CompletedTask;
    internal Func<string, System.Threading.Tasks.Task> ListSiblingTracks { get; set; } =
        _ => System.Threading.Tasks.Task.CompletedTask;
    internal Func<string, System.Threading.Tasks.Task> ImportExternalTrack { get; set; } =
        _ => System.Threading.Tasks.Task.CompletedTask;
    internal Func<bool, System.Threading.Tasks.Task> CheckUpdate { get; set; } =
        _ => System.Threading.Tasks.Task.CompletedTask;
    internal Func<string, System.Threading.Tasks.Task> DownloadUpdate { get; set; } =
        _ => System.Threading.Tasks.Task.CompletedTask;
    internal Action<string> IgnoreUpdate { get; set; } = _ => { };
    internal Action<string> OpenUpdateRelease { get; set; } = _ => { };
}

internal sealed class ViewerMessageRouter
{
    private readonly ViewerMessageActions _actions;

    internal ViewerMessageRouter(ViewerMessageActions actions) => _actions = actions;

    internal void Route(string message)
    {
        if (message.StartsWith("export\t", StringComparison.Ordinal))
            _actions.BeginExport(message.Substring("export\t".Length));
        else if (message.StartsWith("exportchunk\t", StringComparison.Ordinal))
            _actions.AppendExport(message.Substring("exportchunk\t".Length));
        else if (message.StartsWith("exportdone\t", StringComparison.Ordinal))
            _actions.FinishExport(message.Substring("exportdone\t".Length));
        else if (message.StartsWith("clipboard\t", StringComparison.Ordinal))
            _ = _actions.CopyToClipboard(message.Substring("clipboard\t".Length));
        else if (message.StartsWith("attachmentbegin\t", StringComparison.Ordinal))
            _actions.BeginAttachment(message.Substring("attachmentbegin\t".Length));
        else if (message.StartsWith("attachmentlocal\t", StringComparison.Ordinal))
            _ = _actions.CopyLocalAttachment(message.Substring("attachmentlocal\t".Length));
        else if (message.StartsWith("attachmentresume\t", StringComparison.Ordinal))
            _ = _actions.ResumeAttachments(message.Substring("attachmentresume\t".Length));
        else if (message.StartsWith("attachmentchunk\t", StringComparison.Ordinal))
            _actions.AppendAttachment(message.Substring("attachmentchunk\t".Length));
        else if (message.StartsWith("attachmentdone\t", StringComparison.Ordinal))
            _ = _actions.FinishAttachment(message.Substring("attachmentdone\t".Length));
        else if (message.StartsWith("attachmentlink\t", StringComparison.Ordinal))
            _ = _actions.DownloadAttachment(message.Substring("attachmentlink\t".Length));
        else if (message == "ready" || message.StartsWith("ready\t", StringComparison.Ordinal))
            _actions.Ready(message.Length > 6 ? message.Substring(6) : "");
        else if (message.StartsWith("error:", StringComparison.Ordinal))
            _actions.Error(message.Substring("error:".Length));
        else if (message.StartsWith("settings\t", StringComparison.Ordinal))
            _actions.SaveSettings(message.Substring("settings\t".Length));
        else if (message.StartsWith("custom-sources\t", StringComparison.Ordinal))
            _actions.SaveCustomSources(message.Substring("custom-sources\t".Length));
        else if (message == "measure-state\t1" || message == "measure-state\t0")
            _actions.MeasureState(message.EndsWith("\t1", StringComparison.Ordinal));
        else if (message == "editor-state\t1" || message == "editor-state\t0")
            _actions.EditorState(message.EndsWith("\t1", StringComparison.Ordinal));
        else if (message == "editor-dirty\t1" || message == "editor-dirty\t0")
            _actions.EditorDirty(message.EndsWith("\t1", StringComparison.Ordinal));
        else if (message.StartsWith("title-meta\t", StringComparison.Ordinal))
            _actions.TitleMeta(message.Substring("title-meta\t".Length));
        else if (message.StartsWith("trackbegin\t", StringComparison.Ordinal))
            _actions.BeginTrackSave(message.Substring("trackbegin\t".Length));
        else if (message.StartsWith("trackchunk\t", StringComparison.Ordinal))
            _actions.AppendTrackSave(message.Substring("trackchunk\t".Length));
        else if (message.StartsWith("trackdone\t", StringComparison.Ordinal))
            _ = _actions.FinishTrackSave(message.Substring("trackdone\t".Length));
        else if (message == "text-input\t1" || message == "text-input\t0")
            _actions.TextInput(message.EndsWith("\t1", StringComparison.Ordinal));
        else if (message == "text-composing\t1" || message == "text-composing\t0")
            _actions.TextComposing(message.EndsWith("\t1", StringComparison.Ordinal));
        else if (message.StartsWith("tianditu-key\tconfigure", StringComparison.Ordinal))
            _actions.ConfigureTiandituKey(message);
        else if (message.StartsWith("tianditu-key\tremove", StringComparison.Ordinal))
            _actions.RemoveTiandituKey(message);
        else if (message == "tile-cache\tstats")
            _actions.RequestTileCacheStats();
        else if (message == "tile-cache\tclear")
            _actions.ClearTileCache();
        else if (message.StartsWith("probe-node\t", StringComparison.Ordinal))
            _ = _actions.ProbeNode(message.Substring("probe-node\t".Length));
        else if (message.StartsWith("track-import-list\t", StringComparison.Ordinal))
            _ = _actions.ListSiblingTracks(message.Substring("track-import-list\t".Length));
        else if (message.StartsWith("track-import-read\t", StringComparison.Ordinal))
            _ = _actions.ImportExternalTrack(message.Substring("track-import-read\t".Length));
        else if (message == "update-check\t1" || message == "update-check\t0")
            _ = _actions.CheckUpdate(message.EndsWith("\t1", StringComparison.Ordinal));
        else if (message.StartsWith("update-download\t", StringComparison.Ordinal))
            _ = _actions.DownloadUpdate(message.Substring("update-download\t".Length));
        else if (message.StartsWith("update-ignore\t", StringComparison.Ordinal))
            _actions.IgnoreUpdate(message.Substring("update-ignore\t".Length));
        else if (message.StartsWith("update-open\t", StringComparison.Ordinal))
            _actions.OpenUpdateRelease(message.Substring("update-open\t".Length));
    }
}
