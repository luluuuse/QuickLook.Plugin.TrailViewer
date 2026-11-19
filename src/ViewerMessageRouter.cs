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
    internal Action<bool> TextInput { get; set; } = _ => { };
    internal Action<string> ConfigureTiandituKey { get; set; } = _ => { };
    internal Action<string> RemoveTiandituKey { get; set; } = _ => { };
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
        else if (message == "text-input\t1" || message == "text-input\t0")
            _actions.TextInput(message.EndsWith("\t1", StringComparison.Ordinal));
        else if (message.StartsWith("tianditu-key\tconfigure", StringComparison.Ordinal))
            _actions.ConfigureTiandituKey(message);
        else if (message.StartsWith("tianditu-key\tremove", StringComparison.Ordinal))
            _actions.RemoveTiandituKey(message);
    }
}
