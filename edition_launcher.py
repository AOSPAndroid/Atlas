"""Launch an explicit Atlas edition without duplicating the shared application."""
import argparse
import webbrowser
import launcher

PREVIEW = "https://office-atlas-mobile-preview.daaalil.chatgpt.site"

def edition_url(edition, mode):
    path = "/?layout=classic" if edition == "classic" else "/assets/desktop.html"
    if mode == "preview":
        return PREVIEW + path
    specs = launcher.servers()
    spec = next(s for s in specs if s["mode"] == ("admin" if mode == "admin" else "viewer"))
    return f"http://127.0.0.1:{spec['port']}" + path

def launch(edition, mode, open_browser=True):
    if edition not in {"classic", "desktop"} or mode not in {"admin", "demo", "preview", "all"}:
        raise ValueError("Unknown Atlas edition or mode")
    if mode != "preview":
        result = launcher.run(open_browser=False)
        if result:
            return result
    for target in (("admin", "demo") if mode == "all" else (mode,)):
        url = edition_url(edition, target)
        print(url)
        if open_browser:
            webbrowser.open(url)
    return 0

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("edition", choices=["classic", "desktop"])
    parser.add_argument("mode", choices=["admin", "demo", "preview", "all"])
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    raise SystemExit(launch(args.edition, args.mode, not args.no_browser))
