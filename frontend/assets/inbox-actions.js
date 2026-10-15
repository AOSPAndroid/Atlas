/* Live Inbox actions: open the normal Workspace tools for a request's person and machine.
   Every action needs a click. Reboots keep their confirmation, and nothing deploys until
   Install or Start queue is clicked in Workspace. */
(() => {
  const openQueue = () => document.querySelector("#queueDrawer")?.classList.add("open");

  async function focus({ user, machine }) {
    page("workspace");
    if (user?.id && S.user?.id !== user.id) await loadUser("id:" + user.id);
    if (machine) {
      setTarget(machine, "Live inbox request", false);
      if (S.target !== String(machine).toUpperCase())
        throw Error(`${machine} is inventory only; Windows tools need a PC.`);
    }
  }

  async function choosePackage(pkg, action) {
    const select = document.querySelector("#pkg");
    if (![...select.options].some((option) => option.value === pkg.folder))
      select.add(new Option(pkg.display_name || pkg.folder, pkg.folder));
    select.value = pkg.folder;
    commitPackageChoice();
    document.querySelector("#action").value = action || "Install";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await scripts();
    if (!document.querySelector("#script").value)
      throw Error(`No ${action || "Install"} script was found in ${pkg.display_name || pkg.folder}.`);
  }

  async function run(detail = {}) {
    if (window.AtlasReadOnly) throw Error("Live Inbox actions are available in Atlas Admin.");
    const { action, machine, user, pkg, deployAction = "Install" } = detail;
    switch (action) {
      case "target":
        await focus(detail);
        return toast(`${S.target} selected for ${user?.full_name || user?.name || "this request"}`);
      case "health":
        await focus(detail);
        return refreshTargetHealth(true);
      case "performance":
        await focus(detail);
        return page("admin");
      case "user-groups":
        if (!user?.user_name && !user?.email) throw Error("No AD account is known for this sender.");
        return window.AtlasAD.show("user", user.user_name || user.email);
      case "machine-groups":
        await focus(detail);
        return window.AtlasAD.show("computer", S.target);
      case "reboot":
        await focus(detail);
        if (!confirm("Reboot " + S.target + "?")) return;
        await window.AtlasReboots.start(S.target);
        return openQueue();
      case "deploy":
        await focus(detail);
        await choosePackage(pkg, deployAction);
        openDeploymentPanel();
        return toast(`${pkg.display_name || pkg.folder} ready for ${S.target}. Check the script, then click ${deployAction}.`);
      case "queue":
        await focus(detail);
        await choosePackage(pkg, deployAction);
        addQueue();
        return openQueue();
      case "search": {
        await focus(detail);
        openDeploymentPanel();
        document.querySelector("#pkgSearch").value = detail.term || "";
        document.querySelector("#packagePicker").open = true;
        return packages();
      }
      case "kit":
        await focus(detail);
        window.AtlasKits.addToQueue(detail.kit);
        return openQueue();
      case "knowledge":
        return window.AtlasKnowledge.show(detail.document);
      default:
        throw Error("Unknown Live Inbox action.");
    }
  }

  window.AtlasInboxActions = { run };
  window.addEventListener("atlas:inbox-action", (event) => {
    run(event.detail).catch((error) => toast(error.message));
  });
})();
