/**
 * @name AutoQuestComplete
 * @description Ultra-Stealth background macro for automated Discord quest progression featuring sub-tick arithmetic telemetry simulation, NT-compliant process handles.
 * @version 1.0.2
 * @author @aamiaa published by DexterDevKH
 * @authorLink https://github.com/DexterDevKH
 * @website https://github.com/DexterDevKH/AutoQuestComplete
 * @source https://raw.githubusercontent.com/DexterDevKH/AutoQuestComplete/main/AutoQuestComplete.plugin.js
 */

const config = {
    main: 'AutoQuestComplete.plugin.js',
    info: {
        name: 'AutoQuestComplete',
        authorId: "750989197611106314",
        website: "https://github.com/DexterDevKH",
        version: "1.0.2",
        description: "The absolute highest standard of undetectable single-process quest automation with secure native reward redemption handling.",
        author: [
            {
                name: "@aamiaa",
                plugin_author: "DexterDevKH",
                github_username: "DexterDevKH",
            }
        ],
        github: "https://github.com/DexterDevKH/AutoQuestComplete",
        github_raw: "https://raw.githubusercontent.com/DexterDevKH/AutoQuestComplete/main/AutoQuestComplete.plugin.js"
    },
    changelog: [
        {
            title: "v1.0.2: Multi-Quest",
            type: "added",
            items: [
                "Added support for running and completing multiple quests simultaneously.",
                "Simultaneous spoofing for multiple running games and concurrent video/activity heartbeats."
            ]
        }
    ],
    settingsPanel: [
        {
            type: "switch",
            id: "enableNotify",
            name: "New Quest Notification",
            note: "Enable/Disable notification when a new quest is available.",
            value: true
        },
        {
            type: "category",
            id: "notifyRewardTypes",
            name: "Notification Reward Types",
            collapsible: true,
            shown: false,
            settings: [
                {
                    type: "switch",
                    id: 4, // VIRTUAL_CURRENCY
                    name: "Orbs",
                    note: "Notify for quests that reward Discord Orbs.",
                    value: true
                },
                {
                    type: "switch",
                    id: 1, // REWARD_CODE
                    name: "Redeemable Code",
                    note: "Notify for quests that reward a redeemable in-game code.",
                    value: true
                },
                {
                    type: "switch",
                    id: 2, // IN_GAME
                    name: "In-Game Reward",
                    note: "Notify for quests that reward an item directly in the promoted game.",
                    value: true
                },
                {
                    type: "switch", 
                    id: 3, // COLLECTIBLE
                    name: "Collectible",
                    note: "Notify for quests that reward a Discord collectible (e.g. an avatar decoration).",
                    value: true
                },
                {
                    type: "switch",
                    id: 5, // FRACTIONAL_PREMIUM
                    name: "Nitro Trial",
                    note: "Notify for quests that reward a free Nitro (premium) trial.",
                    value: true
                }
            ]
        }
    ]
};

const { Webpack, UI, Logger, Data, Utils, React } = BdApi;

class AutoQuestComplete {
    constructor() {
        this._config = config;
        this._questsStore = Webpack.Stores.QuestStore;
        this._boundHandleQuestChange = this.handleQuestChange.bind(this);
        this._boundNewQuestHandler = this.handleNewQuest.bind(this);
        this._activeQuestIds = new Set();
        this._fakeGames = new Map();
        this._gamesHooked = false;
        this._activeStreamQuestId = null;
        this._unsupportedQuests = new Set();
        this._notifiedQuests = new Set();
        this._remindersTime = new Map();
        this.settings = {};

        try {
            let currentVersionInfo = {};
            try {
                currentVersionInfo = Object.assign({}, { version: this._config.info.version, hasShownChangelog: false }, Data.load(this._config.info.name, "currentVersionInfo"));
            } catch (err) {
                currentVersionInfo = { version: this._config.info.version, hasShownChangelog: false };
            }
            if (this._config.info.version != currentVersionInfo.version) currentVersionInfo.hasShownChangelog = false;
            currentVersionInfo.version = this._config.info.version;
            Data.save(this._config.info.name, "currentVersionInfo", currentVersionInfo);

            this.checkForUpdate();

            if (!currentVersionInfo.hasShownChangelog) {
                UI.showChangelogModal({
                    title: "AutoQuestComplete Changelog",
                    subtitle: this._config.info.version,
                    changes: this._config.changelog
                });
                currentVersionInfo.hasShownChangelog = true;
                Data.save(this._config.info.name, "currentVersionInfo", currentVersionInfo);
            }
        } catch (err) {
            Logger.error(this._config.info.name, err);
        }
    }

    start() {
        const defaultSettings = this._flattenSettings().reduce((acc, setting) => {
            acc[setting.id] = setting.value;
            return acc;
        }, {});
        this.settings = Object.assign(defaultSettings, Data.load(this._config.info.name, "settings") || {});
        try {
            if (this._questsStore && this._questsStore.addChangeListener) {
                this._questsStore.addChangeListener(this._boundHandleQuestChange);
                this._questsStore.addChangeListener(this._boundNewQuestHandler);
            }

            this.handleQuestChange();
        } catch (e) {
            Logger.error(this._config.info.name, "Error while starting AutoQuestComplete", e);
            UI.showToast("Error while starting AutoQuestComplete", { type: "error" });
        }
    }

    stop() {
        if (this._questsStore && this._questsStore.removeChangeListener) {
            this._questsStore.removeChangeListener(this._boundHandleQuestChange);
            this._questsStore.removeChangeListener(this._boundNewQuestHandler);
        }
        for (const [, timeout] of this._remindersTime.entries()) {
            clearTimeout(timeout);
        }

        const RunningGameStore = Webpack.Stores.RunningGameStore;
        if (this._gamesHooked && RunningGameStore) {
            if (this._realGetRunningGames) RunningGameStore.getRunningGames = this._realGetRunningGames;
            if (this._realGetGameForPID) RunningGameStore.getGameForPID = this._realGetGameForPID;
            this._gamesHooked = false;
        }

        const ApplicationStreamingStore = Webpack.Stores.ApplicationStreamingStore;
        if (this._originalStreamerFunc && ApplicationStreamingStore) {
            ApplicationStreamingStore.getStreamerActiveStreamMetadata = this._originalStreamerFunc;
            this._originalStreamerFunc = null;
        }

        this._fakeGames.clear();
        this._activeQuestIds.clear();
        this._unsupportedQuests.clear();
        this._notifiedQuests.clear();
        this._remindersTime.clear();
    }

    _flattenSettings(settings = this._config.settingsPanel) {
        return settings.flatMap(setting =>
            setting.type === "category" && Array.isArray(setting.settings)
                ? this._flattenSettings(setting.settings)
                : [setting]
        );
    }

    getSettingsPanel() {
        for (const setting of this._flattenSettings()) {
            setting.value = this.settings[setting.id];
        }

        return UI.buildSettingsPanel({
            settings: this._config.settingsPanel,
            onChange: (category, id, value) => {
                this.settings[id] = value;
                Data.save(this._config.info.name, "settings", this.settings);
            }
        });
    }

    getQuestApplicationId(quest) {
        const tasks = quest?.config?.taskConfigV2?.tasks ?? {};
        for (const task of Object.values(tasks)) {
            const id = task?.applications?.[0]?.id;
            if (id) return id;
        }
        return quest?.config?.application?.id ?? null;
    }

    getQuestName(quest) {
        return quest?.config?.messages?.questName ?? quest?.config?.messages?.gameTitle ?? "Unknown Quest";
    }

    getQuestRewards(quest) {
        return quest?.config?.rewardsConfig?.rewards ?? [];
    }

    shouldNotifyForQuest(quest) {
        const rewards = this.getQuestRewards(quest);
        if (!rewards.length) return true;
        return rewards.some(reward => this.settings[reward?.type] !== false);
    }

    getRewardText(quest) {
        const parts = this.getQuestRewards(quest).map(reward => {
            if (typeof reward?.orbQuantity === "number" && reward.orbQuantity > 0) {
                return reward.premiumOrbQuantity && reward.premiumOrbQuantity !== reward.orbQuantity 
                    ? `${reward.orbQuantity} Orbs (${reward.premiumOrbQuantity} with Nitro)` 
                    : `${reward.orbQuantity} Orbs`;
            }
            return reward?.messages?.name;
        }).filter(Boolean);

        return parts.length ? parts.join(", ") : null;
    }

    getQuestTaskInfo(quest) {
        const tasks = quest?.config?.taskConfigV2?.tasks ?? {};
        const labels = {
            WATCH_VIDEO: "Watch a video",
            WATCH_VIDEO_ON_MOBILE: "Watch a video (mobile)",
            PLAY_ON_DESKTOP: "Play the game",
            STREAM_ON_DESKTOP: "Stream the game",
            PLAY_ACTIVITY: "Play an activity",
            ACHIEVEMENT_IN_ACTIVITY: "Earn an achievement",
            PLAY_ON_PLAYSTATION: "Play on PlayStation",
            PLAY_ON_XBOX: "Play on Xbox"
        };
        const taskName = Object.keys(labels).find(x => tasks[x] != null);
        if (!taskName) return null;
        const seconds = tasks[taskName]?.target ?? 0;
        if (!seconds) return labels[taskName];
        const duration = seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} sec`;
        return `${labels[taskName]} (~${duration})`;
    }

    formatRelativeTime(dateStr) {
        const ms = new Date(dateStr).getTime() - Date.now();
        if (!Number.isFinite(ms) || ms <= 0) return null;
        const minutes = Math.floor(ms / 60000);
        const days = Math.floor(minutes / 1440);
        const hours = Math.floor((minutes % 1440) / 60);
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes}m`;
    }

    getQuestIconUrl(quest) {
        const assets = quest?.config?.assets ?? {};
        const file = assets.gameTileLight || assets.gameTileDark || assets.logotypeLight;
        if (!file) return null;
        return `https://cdn.discordapp.com/${file}`;
    }

    buildQuestIcon(quest) {
        const url = this.getQuestIconUrl(quest);
        if (!url || !React) return undefined;
        return () => React.createElement("img", {
            src: url,
            width: 36,
            height: 36,
            style: { borderRadius: "8px", objectFit: "cover" },
            onError: (event) => { event.currentTarget.style.display = "none"; }
        });
    }

    buildNotificationContent(quest) {
        const intro = `Accept "${this.getQuestName(quest)}" to start auto-completing.`;
        const reward = this.getRewardText(quest);
        const task = this.getQuestTaskInfo(quest);
        const publisher = quest?.config?.messages?.gamePublisher;
        const expiresIn = this.formatRelativeTime(quest?.config?.expiresAt);

        if (!React) {
            return [
                intro,
                reward && `Reward: ${reward}`,
                task && `Task: ${task}`,
                publisher && `Publisher: ${publisher}`,
                expiresIn && `Expires in ${expiresIn}`
            ].filter(Boolean).join(" • ");
        }

        const e = React.createElement;
        const row = (label, value) => value
            ? e("div", { style: { opacity: 0.95 } }, e("strong", null, `${label}: `), value)
            : null;

        return e("div", { style: { display: "flex", flexDirection: "column", gap: "3px" } },
            e("div", { style: { marginBottom: "2px" } }, intro),
            row("Reward", reward),
            row("Task", task),
            row("Publisher", publisher),
            row("Expires in", expiresIn)
        );
    }

    handleNewQuest() {
        if (!this._questsStore?.quests || !this.settings.enableNotify) return;

        const newQuests = [...this._questsStore.quests.values()].filter(x =>
            !x.userStatus?.enrolledAt &&
            !x.userStatus?.completedAt &&
            new Date(x.config.expiresAt).getTime() > Date.now()
        );

        for (const new_quest of newQuests) {
            const key = new_quest.config.application?.id ?? this.getQuestApplicationId(new_quest) ?? new_quest.id;
            if (!this._notifiedQuests.has(key)) {
                if (!this.shouldNotifyForQuest(new_quest)) continue;
                this._notifiedQuests.add(key);
                this.showQuestNotification(new_quest);
            }
        }
    }

    async openQuests() {
        try {
            const quest_link = document.querySelector('a[href="/quest-home"]');
            if (quest_link) {
                quest_link.click();
                await new Promise(r => setTimeout(r, 300));
                if (location.pathname.startsWith("/quest")) return;
            }

            const Router = Webpack.getModule(m => m?.transitionTo && m?.replaceWith && m?.getHistory, { searchExports: true });
            if (Router?.transitionTo) {
                Router.transitionTo("/quest-home");
                return;
            }

            window.history.pushState({}, "", "/quest-home");
            window.dispatchEvent(new PopStateEvent("popstate"));
        } catch (err) {
            Logger.error(this._config.info.name, "Failed to open quests page", err);
        }
    }

    focusQuestContainer(quest) {
        const quest_title_id = `quest-tile-${quest.id}`;
        let attempts = 0;

        const highlight_container = () => {
            const quest_container = document.getElementById(quest_title_id);
            if (!quest_container) {
                if (attempts++ < 40) {
                    setTimeout(highlight_container, 250);
                } else {
                    Logger.warn(this._config.info.name, `Gave up waiting for ${quest_title_id} to render.`);
                }
                return;
            }

            quest_container.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
            quest_container.setAttribute("tabindex", "-1");
            quest_container.focus({ preventScroll: true });

            const originalOutline = quest_container.style.outline;
            const originalOutlineOffset = quest_container.style.outlineOffset;
            const originalBoxShadow = quest_container.style.boxShadow;
            const originalTransition = quest_container.style.transition;

            quest_container.style.transition = "box-shadow 180ms ease, outline 180ms ease";
            quest_container.style.outline = "3px solid rgba(88, 101, 242, 0.95)";
            quest_container.style.outlineOffset = "6px";
            quest_container.style.boxShadow = "0 0 0 8px rgba(88, 101, 242, 0.2)";

            setTimeout(() => {
                if (!quest_container.isConnected) return;
                quest_container.style.outline = originalOutline;
                quest_container.style.outlineOffset = originalOutlineOffset;
                quest_container.style.boxShadow = originalBoxShadow;
                quest_container.style.transition = originalTransition;
            }, 5000);
        };

        setTimeout(highlight_container, 250);
    }

    showQuestNotification(quest, reminder = false) {
        if (!quest) return;
        const title = reminder ? `Reminder: New Quest Available!` : `New Quest Available!`;
        const key = quest.config.application?.id ?? this.getQuestApplicationId(quest) ?? quest.id;

        UI.showNotification({
            title: title,
            content: this.buildNotificationContent(quest),
            icon: this.buildQuestIcon(quest),
            type: "info",
            duration: 5 * 60 * 1000,
            actions: [
                {
                    label: "Go to Quests",
                    onClick: async () => {
                        await this.openQuests();
                        this.focusQuestContainer(quest);
                    }
                },
                {
                    label: "Remind Me Later",
                    onClick: () => {
                        const existing_reminder = this._remindersTime.get(key);
                        if (existing_reminder) clearTimeout(existing_reminder);
                        const reminderTimeout = setTimeout(() => {
                            this._remindersTime.delete(key);
                            this.showQuestNotification(quest, true);
                        }, 60 * 60 * 1000);
                        this._remindersTime.set(key, reminderTimeout);
                    }
                }
            ]
        });
    }

    handleQuestChange() {
        if (!this._questsStore?.quests) return;

        const quests = [...this._questsStore.quests.values()].filter(x =>
            !this._unsupportedQuests.has(x.id) &&
            x.userStatus?.enrolledAt &&
            !x.userStatus?.completedAt &&
            new Date(x.config.expiresAt).getTime() > Date.now()
        );

        for (const quest of quests) {
            if (!this._activeQuestIds.has(quest.id)) {
                this._activeQuestIds.add(quest.id);
                const questName = this.getQuestName(quest);
                UI.showToast(`Starting quest: ${questName}`, { type: "info" });
                this.runQuest(quest);
            }
        }
    }

    runQuest(quest) {
        const questName = this.getQuestName(quest);
        const questAppId = quest.config.application?.id ?? this.getQuestApplicationId(quest) ?? quest.id;

        try {
            delete window.$;

            const ApplicationStreamingStore = Webpack.Stores.ApplicationStreamingStore;
            const FluxDispatcher = Webpack.getByKeys('dispatch', 'subscribe', 'register', { searchExports: true });
            const api = Webpack.getModule(m => m?.Bo?.get)?.Bo;
            const RunningGameStore = Webpack.Stores.RunningGameStore;

            if (this._remindersTime.has(questAppId)) {
                clearTimeout(this._remindersTime.get(questAppId));
                this._remindersTime.delete(questAppId);
            }

            if (this._notifiedQuests.has(questAppId)) {
                this._notifiedQuests.delete(questAppId);
            }

            const pid = Math.floor(Math.random() * 30000) + 1000;
            const taskName = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE", "ACHIEVEMENT_IN_ACTIVITY"]
                .find(x => quest.config?.taskConfigV2?.tasks?.[x] != null);

            if (!taskName) {
                this._activeQuestIds.delete(quest.id);
                if (this._unsupportedQuests.has(quest.id)) return;
                this._unsupportedQuests.add(quest.id);
                Logger.info(this._config.info.name, `${questName} is not supported by this plugin. (Consoles/Unsupported task)`);
                UI.showToast(`Skipping ${questName}.`, { type: "warning" });
                return;
            }

            const secondsNeeded = quest.config.taskConfigV2.tasks[taskName].target;
            let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

            if (taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
                const speed = 7;
                let isFinished = false;

                (async () => {
                    try {
                        while (true) {
                            const remain = Math.min(speed, secondsNeeded - secondsDone);
                            await new Promise(resolve => setTimeout(resolve, remain * 1000));
                            const timestamp = secondsDone + speed;

                            const response = await api.post({ 
                                url: `/quests/${quest.id}/video-progress`, 
                                body: { timestamp: Math.min(secondsNeeded, timestamp + Math.random()) } 
                            });
                            isFinished = response?.body?.completed_at != null;
                            secondsDone = Math.min(secondsNeeded, timestamp);

                            if (timestamp >= secondsNeeded || isFinished) {
                                break;
                            }
                        }
                        if (!isFinished) {
                            await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: secondsNeeded } });
                        }
                        Logger.info(this._config.info.name, `Quest completed: ${questName}!`);
                        UI.showToast(`Quest completed: ${questName}!`, { type: "success" });
                    } catch (e) {
                        Logger.error(this._config.info.name, `Error during video progress for ${questName}:`, e);
                    } finally {
                        this._activeQuestIds.delete(quest.id);
                    }
                })();

                Logger.info(this._config.info.name, `Spoofing video for ${questName}.`);
                UI.showToast(`Spoofing video for ${questName}. Wait ~${Math.ceil((secondsNeeded - secondsDone) / speed)} sec.`, { type: "info" });
            }
            else if (taskName === "PLAY_ON_DESKTOP") {
                if (!questAppId) {
                    Logger.error(this._config.info.name, `Could not resolve the application id for "${questName}".`);
                    UI.showToast(`Could not resolve the application id for "${questName}".`, { type: "error" });
                    this._activeQuestIds.delete(quest.id);
                    return;
                }

                api.get({ url: `/applications/public?application_ids=${questAppId}` }).then(res => {
                    const appData = res?.body?.[0];
                    if (!appData) {
                        this._activeQuestIds.delete(quest.id);
                        return;
                    }

                    const exeName = appData.executables?.find(x => x.os === "win32")?.name?.replace(">", "") ?? appData.name.replace(/[\/\\:*?"<>|]/g, "");
                    const fakeGame = {
                        cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
                        exeName,
                        exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
                        hidden: false,
                        isLauncher: false,
                        id: questAppId,
                        name: appData.name,
                        pid: pid,
                        pidPath: [pid],
                        processName: appData.name,
                        start: Date.now(),
                    };

                    if (!this._gamesHooked) {
                        this._realGetRunningGames = RunningGameStore.getRunningGames;
                        this._realGetGameForPID = RunningGameStore.getGameForPID;

                        RunningGameStore.getRunningGames = () => {
                            const real = this._realGetRunningGames ? this._realGetRunningGames.call(RunningGameStore) : [];
                            return [...real, ...this._fakeGames.values()];
                        };
                        RunningGameStore.getGameForPID = (p) => {
                            for (const game of this._fakeGames.values()) {
                                if (game.pid === p) return game;
                            }
                            return this._realGetGameForPID ? this._realGetGameForPID.call(RunningGameStore, p) : null;
                        };
                        this._gamesHooked = true;
                    }

                    this._fakeGames.set(quest.id, fakeGame);

                    const currentReal = this._realGetRunningGames ? this._realGetRunningGames.call(RunningGameStore) : [];
                    FluxDispatcher.dispatch({ 
                        type: "RUNNING_GAMES_CHANGE", 
                        removed: [], 
                        added: [fakeGame], 
                        games: [...currentReal, ...this._fakeGames.values()] 
                    });

                    let fn = data => {
                        if (data?.questId && data.questId !== quest.id) return;
                        if (data?.userStatus?.questId && data.userStatus.questId !== quest.id) return;

                        let progress = quest.config.configVersion === 1 
                            ? data?.userStatus?.streamProgressSeconds 
                            : Math.floor(data?.userStatus?.progress?.PLAY_ON_DESKTOP?.value ?? 0);

                        if (progress == null || isNaN(progress)) return;

                        Logger.info(this._config.info.name, `Quest progress (${questName}): ${progress}/${secondsNeeded}`);
                        UI.showToast(`Quest progress (${questName}): ${progress}/${secondsNeeded}`, { type: "info" });

                        if (progress >= secondsNeeded) {
                            Logger.info(this._config.info.name, `Quest completed: ${questName}!`);
                            UI.showToast(`Quest completed: ${questName}!`, { type: "success" });

                            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                            this._fakeGames.delete(quest.id);
                            this._activeQuestIds.delete(quest.id);

                            const remainingReal = this._realGetRunningGames ? this._realGetRunningGames.call(RunningGameStore) : [];
                            FluxDispatcher.dispatch({ 
                                type: "RUNNING_GAMES_CHANGE", 
                                removed: [fakeGame], 
                                added: [], 
                                games: [...remainingReal, ...this._fakeGames.values()] 
                            });

                            if (this._fakeGames.size === 0 && this._gamesHooked) {
                                RunningGameStore.getRunningGames = this._realGetRunningGames;
                                RunningGameStore.getGameForPID = this._realGetGameForPID;
                                this._gamesHooked = false;
                            }
                        }
                    };

                    FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                    Logger.info(this._config.info.name, `Spoofed game to ${questName}. Wait ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min.`);
                    UI.showToast(`Spoofed game to ${questName}. Wait ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min.`, { type: "info" });
                }).catch(err => {
                    this._activeQuestIds.delete(quest.id);
                    Logger.error(this._config.info.name, `Error fetching app info for ${questName}:`, err);
                });
            }
            else if (taskName === "STREAM_ON_DESKTOP") {
                (async () => {
                    while (this._activeStreamQuestId && this._activeStreamQuestId !== quest.id) {
                        await new Promise(r => setTimeout(r, 5000));
                    }
                    this._activeStreamQuestId = quest.id;

                    if (!this._originalStreamerFunc) {
                        this._originalStreamerFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;
                    }

                    ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
                        id: questAppId,
                        pid,
                        sourceName: null
                    });

                    let fn = data => {
                        if (data?.questId && data.questId !== quest.id) return;
                        if (data?.userStatus?.questId && data.userStatus.questId !== quest.id) return;

                        let progress = quest.config.configVersion === 1 
                            ? data?.userStatus?.streamProgressSeconds 
                            : Math.floor(data?.userStatus?.progress?.STREAM_ON_DESKTOP?.value ?? 0);

                        if (progress == null || isNaN(progress)) return;

                        Logger.info(this._config.info.name, `Quest progress (${questName}): ${progress}/${secondsNeeded}`);
                        UI.showToast(`Quest progress (${questName}): ${progress}/${secondsNeeded}`, { type: "info" });

                        if (progress >= secondsNeeded) {
                            Logger.info(this._config.info.name, `Quest completed: ${questName}!`);
                            UI.showToast(`Quest completed: ${questName}!`, { type: "success" });

                            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                            if (this._activeStreamQuestId === quest.id) {
                                this._activeStreamQuestId = null;
                                if (this._originalStreamerFunc) {
                                    ApplicationStreamingStore.getStreamerActiveStreamMetadata = this._originalStreamerFunc;
                                    this._originalStreamerFunc = null;
                                }
                            }
                            this._activeQuestIds.delete(quest.id);
                        }
                    };

                    FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                    Logger.info(this._config.info.name, `Spoofed stream to ${questName}. Stream ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min. (Need at least one VC peer)`);
                    UI.showToast(`Spoofed stream to ${questName}. Stream ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min. (Need at least one VC peer)`, { type: "info" });
                })();
            }
            else if (taskName === "PLAY_ACTIVITY") {
                const channelId = Webpack.Stores.ChannelStore.getSortedPrivateChannels()[0]?.id ||
                    Object.values(Webpack.Stores.GuildChannelStore.getAllGuilds()).find(x => x && x.VOCAL.length > 0)?.VOCAL?.[0]?.channel?.id;

                if (!channelId) {
                    Logger.error(this._config.info.name, `Could not find a voice channel for ${questName}.`);
                    this._activeQuestIds.delete(quest.id);
                    return;
                }

                const streamKey = `call:${channelId}:1`;
                (async () => {
                    try {
                        Logger.info(this._config.info.name, `Completing quest ${questName}`);
                        UI.showToast(`Completing quest ${questName}`, { type: "info" });
                        while (true) {
                            const res = await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: false } });
                            const progress = res?.body?.progress?.PLAY_ACTIVITY?.value;
                            Logger.info(this._config.info.name, `Quest progress (${questName}): ${progress}/${secondsNeeded}`);
                            UI.showToast(`Quest progress (${questName}): ${progress}/${secondsNeeded}`, { type: "info" });
                            await new Promise(resolve => setTimeout(resolve, 20000));
                            if (progress >= secondsNeeded) {
                                await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: true } });
                                break;
                            }
                        }
                        Logger.info(this._config.info.name, `Quest completed: ${questName}!`);
                        UI.showToast(`Quest completed: ${questName}!`, { type: "success" });
                    } catch (err) {
                        Logger.error(this._config.info.name, `Error in activity quest ${questName}:`, err);
                    } finally {
                        this._activeQuestIds.delete(quest.id);
                    }
                })();
            }
            else if (taskName === "ACHIEVEMENT_IN_ACTIVITY") {
                this._activeQuestIds.delete(quest.id);
                if (this._unsupportedQuests.has(quest.id)) return;
                this._unsupportedQuests.add(quest.id);
                UI.showConfirmationModal("Unsupported Quest Task", [`The quest "${questName}" has an unsupported Quest type: ${taskName}.`, "AutoQuestComplete will not be able to complete this quest. Because it's a server-side quest.\n  **Please complete it manually**."], {
                    confirmText: "Go to Quest",
                    onConfirm: async () => {
                        await new Promise(resolve => {
                            const started = Date.now();
                            const check = () => {
                                if (!document.querySelector('[role="dialog"]') || Date.now() - started > 3000) return resolve();
                                setTimeout(check, 100);
                            };
                            check();
                        });
                        await this.openQuests();
                        this.focusQuestContainer(quest);
                    }
                });
            }
        } catch (err) {
            this._activeQuestIds.delete(quest.id);
            UI.showConfirmationModal("Error", ["An error occurred while trying to complete the quest. Please reach out to developer with the following information:", `Quest Name: ${questName}`, `Error: ${err.message}`, `Or click to send report to create an issue on github`], {
                confirmText: "Report Issue",
                onConfirm: async () => {
                    const issueTitle = encodeURIComponent(`Error while completing quest: ${questName}`);
                    const issueBody = encodeURIComponent(`**Quest Name:** ${questName}\n**Error:** ${err.message}\n**Stack Trace:**\n\`\`\`${err.stack}\`\`\``);
                    const issueUrl = `https://github.com/DexterDevKH/AutoQuestComplete/issues/new?title=${issueTitle}&body=${issueBody}`;
                    open(issueUrl);
                },
            });
        }
    }

    async checkForUpdate() {
        try {
            let fileContent = await (await fetch(this._config.info.github_raw, { headers: { "User-Agent": "BetterDiscord" } })).text();
            let remoteMeta = this.parseMeta(fileContent);
            if (Utils.semverCompare(this._config.info.version, remoteMeta.version) > 0) {
                this.newUpdateNotify(remoteMeta, fileContent);
            }
        } catch (err) {
            Logger.error(this._config.info.name, err);
        }
    }

    newUpdateNotify(remoteMeta, remoteFile) {
        Logger.info(this._config.info.name, "A new update is available!");

        UI.showNotification({
            title: `${this._config.info.name} Update Available!`,
            content: `Version ${remoteMeta.version} is now available!`,
            type: "info",
            duration: 1/0,
            actions: [
                {
                    label: "Update Now",
                    onClick: async () => {
                        if (remoteFile) {
                            await new Promise(r => require("fs").writeFile(require("path").join(BdApi.Plugins.folder, `${this._config.info.name}.plugin.js`), remoteFile, r));
                            try {
                                let currentVersionInfo = Data.load(this._config.info.name, "currentVersionInfo");
                                currentVersionInfo.hasShownChangelog = false;
                                Data.save(this._config.info.name, "currentVersionInfo", currentVersionInfo);
                            } catch (err) {
                                UI.showToast("An error occurred when trying to download the update!", { type: "error" });
                                Logger.error(this._config.info.name, "An error occurred when trying to download the update!", err);
                            }
                        }
                    }
                },
                {
                    label: "Update Later",
                    onClick: () => { }
                }
            ]
        });
    }

    parseMeta(fileContent) {
        const meta = {};
        const regex = /@([a-zA-Z]+)\s+(.+)/g;
        let match;
        while ((match = regex.exec(fileContent)) !== null) {
            meta[match[1]] = match[2].trim();
        }
        return meta;
    }
}

module.exports = AutoQuestComplete;
