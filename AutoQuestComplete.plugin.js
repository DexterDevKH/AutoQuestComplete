/**
 * @name AutoQuestComplete
 * @description Ultra-Stealth background macro for automated Discord quest progression featuring sub-tick arithmetic telemetry simulation, NT-compliant process handles, and proactive enrollment.
 * @version 1.0.0
 * @author @aamiaa published by DexterDevKH
 * @authorLink https://github.com/DexterDevKH
 * @website https://github.com/DexterDevKH/AutoQuestComplete
 * @source https://raw.githubusercontent.com/DexterDevKH/AutoQuestComplete/main/AutoQuestComplete.plugin.js
 */

const config = {
    main: 'AutoQuestComplete.plugin.js',
    info: {
        name: 'AutoQuestComplete',
        authorId: "709210314230726776",
        website: "https://github.com/DexterDevKH/AutoQuestComplete",
        version: "1.0.0",
        description: "The absolute highest standard of undetectable single-process quest automation with secure native reward redemption handling.",
        author: [{ name: "@aamiaa", plugin_author: "DexterDevKH" }],
        github: "https://github.com/DexterDevKH/AutoQuestComplete",
        github_raw: "https://raw.githubusercontent.com/DexterDevKH/AutoQuestComplete/main/AutoQuestComplete.plugin.js"
    },
    changelog: [
        {
            title: "Security Hardening",
            type: "fixed",
            items: [
                "Safely stripped away legacy background auto-claiming arrays to completely protect accounts from anti-cheat system detection flags."
            ]
        }
    ],
    settingsPanel: [
        { type: "switch", id: "autoEnroll", name: "Auto-Enroll Quests", note: "Automatically accepts new quests as soon as they drop.", value: true },
        { type: "switch", id: "enableNotify", name: "Status Notifications", note: "Notifies when a macro cycle state mutates.", value: true }
    ]
};

const { Webpack, UI, Logger, Data, Utils } = BdApi;

class AutoQuestComplete {
    constructor() {
        this._config = config;
        this.settings = {};
        this.stores = {};
        this.api = null;
        this.dispatcher = null;

        this.runningPipelines = new Map();
        this.failedQuestsQueue = new Set();
        this.rateLimitCoolingPool = new Map();

        this._questChangeBound = this.evaluateQuestStateMatrix.bind(this);
    }

    start() {
        this.loadSettings();
        if (!this.resolveDiscordModules()) {
            UI.showToast("Failed to compile internal runtime bindings safely.", { type: "error" });
            return;
        }

        if (this.stores.QuestStore?.addChangeListener) {
            this.stores.QuestStore.addChangeListener(this._questChangeBound);
        }

        setTimeout(() => this.evaluateQuestStateMatrix(), 1000);
    }

    stop() {
        if (this.stores.QuestStore?.removeChangeListener) {
            this.stores.QuestStore.removeChangeListener(this._questChangeBound);
        }

        this.abortAllRunningPipelines();
        Logger.info(this._config.info.name, "Terminated background tasks cleanly.");
    }

    loadSettings() {
        this.settings = Data.load(this._config.info.name, "settings") || this._config.settingsPanel.reduce((acc, s) => {
            acc[s.id] = s.value;
            return acc;
        }, {});
    }

    getSettingsPanel() {
        return UI.buildSettingsPanel({
            settings: this._config.settingsPanel,
            onChange: (_, id, value) => {
                this.settings[id] = value;
                Data.save(this._config.info.name, "settings", this.settings);
            }
        });
    }

    resolveDiscordModules() {
        try {
            this.dispatcher = Webpack.getByKeys('dispatch', 'subscribe', 'register', { searchExports: true });

            const baseApi = Webpack.getModule(m => m?.Bo?.get)?.Bo || Webpack.getModule(m => m?.get && m?.post && m?.put);
            if (baseApi) {
                this.api = baseApi;
            } else {
                const networkModule = Webpack.getModule(m => m?.getRestRequestStore);
                if (networkModule) this.api = networkModule;
            }

            this.stores.QuestStore = Webpack.Stores.QuestStore;
            this.stores.RunningGameStore = Webpack.Stores.RunningGameStore;
            this.stores.ApplicationStreamingStore = Webpack.Stores.ApplicationStreamingStore;
            this.stores.ChannelStore = Webpack.Stores.ChannelStore;
            this.stores.GuildChannelStore = Webpack.Stores.GuildChannelStore;

            return !!(this.api && this.dispatcher && this.stores.QuestStore);
        } catch (e) {
            Logger.error(this._config.info.name, "Critical Dependency Mapping Interrupted", e);
            return false;
        }
    }

    async evaluateQuestStateMatrix() {
        if (!this.stores.QuestStore?.quests) return;
        const completeList = [...this.stores.QuestStore.quests.values()];

        const tasks = completeList.map(async (quest) => {
            const questId = quest.id;

            if (new Date(quest.config.expiresAt).getTime() <= Date.now()) return;
            if (this.rateLimitCoolingPool.has(questId) && Date.now() < this.rateLimitCoolingPool.get(questId)) return;

            const userStatus = quest.userStatus;

            if (!userStatus?.enrolledAt) {
                if (this.settings.autoEnroll && !this.failedQuestsQueue.has(questId)) {
                    await this.executeEnrollmentPatch(questId);
                }
                return;
            }

            // Cleanly ignore completed quests so the user can claim them naturally via native layout UI panels
            if (userStatus?.completedAt && !userStatus?.claimedAt) {
                return;
            }

            if (userStatus?.enrolledAt && !userStatus?.completedAt) {
                if (!this.runningPipelines.has(questId)) {
                    this.dispatchAutomationWorker(quest);
                }
            }
        });

        await Promise.allSettled(tasks);
    }

    async executeEnrollmentPatch(questId) {
        try {
            Logger.info(this._config.info.name, `Auto-enrolling into quest identity instance: ${questId}`);
            const response = await this.api.post({ url: `/quests/${questId}/enroll` });
            if (response?.ok || response?.status === 200) {
                if (this.settings.enableNotify) UI.showToast("Successfully accepted available Quest target!", { type: "success" });
                if (this.dispatcher) {
                    this.dispatcher.dispatch({ type: "QUESTS_ENROLL_SUCCESS", questId });
                }
            }
        } catch (err) {
            this.applyBackoffCooling(questId, err);
        }
    }

    dispatchAutomationWorker(quest) {
        const questId = quest.id;
        const abortController = new AbortController();
        this.runningPipelines.set(questId, abortController);

        this.processTaskExecution(quest, abortController.signal).catch(err => {
            Logger.error(this._config.info.name, `Worker process crashed for ${questId}`, err);
            this.runningPipelines.delete(questId);
        });
    }

    async processTaskExecution(quest, signal) {
        const taskName = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE", "ACHIEVEMENT_IN_ACTIVITY"]
            .find(x => quest.config.taskConfigV2?.tasks?.[x] != null);

        if (!taskName) return;

        const targetTime = quest.config.taskConfigV2.tasks[taskName].target;
        let currentTime = quest.userStatus?.progress?.[taskName]?.value ?? 0;

        if (currentTime >= targetTime) return;

        this.simulateUserInteractionFocus(quest.config.application.id);

        switch (taskName) {
            case "WATCH_VIDEO":
            case "WATCH_VIDEO_ON_MOBILE":
                await this.runVideoTelemetryEngine(quest, targetTime, currentTime, signal);
                break;
            case "PLAY_ON_DESKTOP":
                await this.runDesktopGameSpoofer(quest, targetTime, signal);
                break;
            case "STREAM_ON_DESKTOP":
                await this.runStreamTelemetryEngine(quest, targetTime, signal);
                break;
            case "PLAY_ACTIVITY":
                await this.runVoiceActivityEngine(quest, targetTime, signal);
                break;
            default:
                this.failedQuestsQueue.add(quest.id);
                break;
        }
    }

    simulateUserInteractionFocus(applicationId) {
        try {
            this.dispatcher.dispatch({
                type: "TRACKING_EVENT",
                event: "quest_interaction_initiated",
                properties: { application_id: applicationId, client_focused: true, tick_count: Date.now() }
            });
        } catch { }
    }

    async runVideoTelemetryEngine(quest, target, current, signal) {
        let localProgress = parseFloat(current);

        while (localProgress < target) {
            if (signal.aborted) return;

            const frameStep = 5 + Math.floor(Math.random() * 5);
            const elasticThrottle = (frameStep * 1000) + (Math.floor(Math.random() * 500) - 250);

            await new Promise((res) => setTimeout(res, Math.max(1000, elasticThrottle)));

            const dynamicJitter = Math.random() * 0.298412;
            let computedProgress = localProgress + frameStep + dynamicJitter;

            if (computedProgress >= target) {
                computedProgress = target;
            }

            const serializedProgress = parseFloat(computedProgress.toFixed(6));

            try {
                const response = await this.api.post({
                    url: `/quests/${quest.id}/video-progress`,
                    body: { timestamp: serializedProgress }
                });

                if (response?.body?.completed_at) {
                    if (this.settings.enableNotify) UI.showToast(`Quest "${quest.config.application.name}" Complete! Redeem rewards in your Gift Inventory window.`, { type: "success" });
                    this.runningPipelines.delete(quest.id);
                    return;
                }
                localProgress = serializedProgress;
            } catch (err) {
                if (this.applyBackoffCooling(quest.id, err)) return;
            }
        }
    }

    async runDesktopGameSpoofer(quest, target, signal) {
        const appId = quest.config.application.id;

        let randomPid = Math.floor(Math.random() * 15000) + 10000;
        randomPid = randomPid - (randomPid % 4);

        try {
            const lookup = await this.api.get({ url: `/applications/public?application_ids=${appId}` });
            const appData = lookup.body?.[0];
            if (!appData) throw new Error("Application metadata validation error.");

            const exeName = appData.executables?.find(x => x.os === "win32")?.name?.replace(">", "") || `${appData.name}.exe`;

            const mockProcessHandle = {
                cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
                exeName,
                exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
                hidden: false,
                isLauncher: false,
                id: appId,
                name: appData.name,
                pid: randomPid,
                pidPath: [randomPid],
                processName: appData.name,
                start: Date.now() - (Math.random() * 4000),
            };

            const originalGetGames = this.stores.RunningGameStore.getRunningGames;
            const originalGetPid = this.stores.RunningGameStore.getGameForPID;

            this.stores.RunningGameStore.getRunningGames = () => {
                const currentList = originalGetGames.call(this.stores.RunningGameStore) || [];
                return [...currentList, mockProcessHandle];
            };

            this.stores.RunningGameStore.getGameForPID = (p) => {
                if (p === randomPid) return mockProcessHandle;
                return originalGetPid.call(this.stores.RunningGameStore, p);
            };

            this.dispatcher.dispatch({
                type: "RUNNING_GAMES_CHANGE",
                removed: [],
                added: [mockProcessHandle],
                games: this.stores.RunningGameStore.getRunningGames()
            });

            const unhookInterceptor = () => {
                this.stores.RunningGameStore.getRunningGames = originalGetGames;
                this.stores.RunningGameStore.getGameForPID = originalGetPid;
                this.dispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [mockProcessHandle], added: [], games: originalGetGames.call(this.stores.RunningGameStore) });
                this.dispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", monitorHeartbeatMatrix);
                this.runningPipelines.delete(quest.id);
                if (this.settings.enableNotify) UI.showToast(`Quest "${quest.config.application.name}" Complete! Redeem rewards in your Gift Inventory window.`, { type: "success" });
            };

            const monitorHeartbeatMatrix = (data) => {
                if (signal.aborted) { unhookInterceptor(); return; }
                const freshValue = Math.floor(data?.userStatus?.progress?.PLAY_ON_DESKTOP?.value ?? 0);
                if (freshValue >= target) unhookInterceptor();
            };

            this.dispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", monitorHeartbeatMatrix);
        } catch (e) {
            this.runningPipelines.delete(quest.id);
        }
    }

    async runStreamTelemetryEngine(quest, target, signal) {
        const originalStreamMetadata = this.stores.ApplicationStreamingStore.getStreamerActiveStreamMetadata;

        let fakePid = Math.floor(Math.random() * 10000) + 20000;
        fakePid = fakePid - (fakePid % 4);

        this.stores.ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
            id: quest.config.application.id,
            pid: fakePid,
            sourceName: null
        });

        const unhookStream = () => {
            this.stores.ApplicationStreamingStore.getStreamerActiveStreamMetadata = originalStreamMetadata;
            this.dispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", monitorStreamPayload);
            this.runningPipelines.delete(quest.id);
            if (this.settings.enableNotify) UI.showToast(`Quest "${quest.config.application.name}" Complete! Redeem rewards in your Gift Inventory window.`, { type: "success" });
        };

        const monitorStreamPayload = (data) => {
            if (signal.aborted) { unhookStream(); return; }
            const progressValue = Math.floor(data?.userStatus?.progress?.STREAM_ON_DESKTOP?.value ?? 0);
            if (progressValue >= target) unhookStream();
        };

        this.dispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", monitorStreamPayload);
    }

    async runVoiceActivityEngine(quest, target, signal) {
        const fallBackChannelId = this.stores.ChannelStore?.getSortedPrivateChannels?.()[0]?.id ||
            Object.values(this.stores.GuildChannelStore?.getAllGuilds?.() || {}).find(g => g && g.VOCAL?.length > 0)?.VOCAL[0]?.channel?.id;

        if (!fallBackChannelId) {
            this.runningPipelines.delete(quest.id);
            return;
        }

        const streamKeyPayload = `call:${fallBackChannelId}:1`;

        while (true) {
            if (signal.aborted) return;

            try {
                const packetResponse = await this.api.post({
                    url: `/quests/${quest.id}/heartbeat`,
                    body: { stream_key: streamKeyPayload, terminal: false }
                });

                const realTimeProgress = packetResponse.body?.progress?.PLAY_ACTIVITY?.value ?? 0;
                if (realTimeProgress >= target) {
                    await this.api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKeyPayload, terminal: true } });
                    this.runningPipelines.delete(quest.id);
                    if (this.settings.enableNotify) UI.showToast(`Quest "${quest.config.application.name}" Complete! Redeem rewards in your Gift Inventory window.`, { type: "success" });
                    return;
                }
            } catch (err) {
                if (this.applyBackoffCooling(quest.id, err)) return;
            }

            const elasticDelay = 20000 + Math.floor(Math.random() * 3500);
            await new Promise(res => setTimeout(res, elasticDelay));
        }
    }

    applyBackoffCooling(questId, errorResponse) {
        let penaltyTime = 30000;

        if (errorResponse?.status === 429) {
            const serverRetryHeader = errorResponse?.headers?.['retry-after'];
            penaltyTime = serverRetryHeader ? (parseFloat(serverRetryHeader) * 1000) + 5000 : 60000;
        }

        Logger.warn(this._config.info.name, `Quest [${questId}] triggered a network cooler. Suspending processing for ${penaltyTime}ms.`);
        this.rateLimitCoolingPool.set(questId, Date.now() + penaltyTime);

        const pipeline = this.runningPipelines.get(questId);
        if (pipeline) {
            pipeline.abort();
            this.runningPipelines.delete(questId);
        }
        return true;
    }

    abortAllRunningPipelines() {
        for (const [questId, controller] of this.runningPipelines.entries()) {
            controller.abort();
        }
        this.runningPipelines.clear();
    }
}

module.exports = AutoQuestComplete;