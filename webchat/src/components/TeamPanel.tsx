import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader,
  RefreshCw,
  Users,
} from "lucide-react";
import {
  createProfile,
  createTeamWorkspace,
  deleteProfile,
  fetchAgentPresets,
  fetchProfileDetail,
  fetchTeams,
  updateProfile,
  type AgentPreset,
  type AgentProfile,
  type ProfileDetail,
  type TeamsResponse,
  type TeamTemplate,
} from "../lib/teams";
import { matchesTemplateSessionKey } from "../lib/team-utils";
import { createBlankProfileDetail } from "./team-panel/profile-detail";
import TeamManagementPanel from "./team-panel/TeamManagementPanel";
import TeamStage from "./team-panel/TeamStage";

const VillageScene = lazy(() => import("../village/VillageScene"));

export default function TeamPanel({
  activeSessionKey,
  onSwitchTeam,
}: {
  activeSessionKey: string;
  onSwitchTeam: (sessionKey: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamsData, setTeamsData] = useState<TeamsResponse | null>(null);
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [launchingTemplate, setLaunchingTemplate] = useState<string | null>(
    null,
  );
  const [editing, setEditing] = useState<ProfileDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [villageTemplate, setVillageTemplate] = useState<TeamTemplate | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const [spotlightTemplateId, setSpotlightTemplateId] = useState<string | null>(null);
  const [hasAutoOpenedVillage, setHasAutoOpenedVillage] = useState(false);

  const loadTeams = useCallback(async () => {
    setError(null);
    try {
      const [payload, agentPresets] = await Promise.all([
        fetchTeams(),
        fetchAgentPresets(),
      ]);
      setTeamsData(payload);
      setPresets(agentPresets);
    } catch {
      setError("获取列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const profiles: AgentProfile[] = useMemo(
    () => teamsData?.profiles ?? [],
    [teamsData],
  );
  const templates: TeamTemplate[] = useMemo(
    () => teamsData?.templates ?? [],
    [teamsData],
  );
  const activeTemplate = useMemo(
    () => templates.find((template) => matchesTemplateSessionKey(template, activeSessionKey)) ?? null,
    [activeSessionKey, templates],
  );
  const spotlightTemplate = useMemo(
    () =>
      templates.find((template) => template.id === spotlightTemplateId) ??
      activeTemplate ??
      templates[0] ??
      null,
    [activeTemplate, spotlightTemplateId, templates],
  );

  useEffect(() => {
    if (!templates.length) {
      setSpotlightTemplateId(null);
      return;
    }
    setSpotlightTemplateId((current) => {
      if (current && templates.some((template) => template.id === current)) {
        return current;
      }
      return activeTemplate?.id ?? templates[0].id;
    });
  }, [activeTemplate, templates]);

  useEffect(() => {
    if (hasAutoOpenedVillage || !templates.length) return;
    const initialTemplate = activeTemplate ?? templates[0];
    if (!initialTemplate) return;
    setVillageTemplate(initialTemplate);
    setHasAutoOpenedVillage(true);
  }, [activeTemplate, hasAutoOpenedVillage, templates]);

  const handleLaunchTeam = useCallback(
    async (template: TeamTemplate) => {
      if (matchesTemplateSessionKey(template, activeSessionKey)) {
        onSwitchTeam(activeSessionKey);
        return;
      }

      setLaunchingTemplate(template.id);
      setError(null);
      try {
        const created = await createTeamWorkspace(template.id);
        onSwitchTeam(created.workspaceKey);
      } catch {
        setError("启动团队失败");
      } finally {
        setLaunchingTemplate(null);
      }
    },
    [activeSessionKey, onSwitchTeam],
  );

  const handleCreate = () => {
    setEditing(null);
    setCreating(true);
    setManagementOpen(true);
  };

  const handleEdit = async (name: string) => {
    setError(null);
    try {
      const detail = await fetchProfileDetail(name);
      setCreating(false);
      setEditing(detail);
      setManagementOpen(true);
    } catch {
      setError("加载配置失败");
    }
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(`确定删除 Agent「${name}」？此操作不可恢复。`)) return;
    setDeleting(name);
    setError(null);
    try {
      await deleteProfile(name);
      await loadTeams();
    } catch {
      setError("删除失败");
    } finally {
      setDeleting(null);
    }
  };

  const handleSave = async (detail: ProfileDetail) => {
    setSaving(true);
    setError(null);
    try {
      if (creating) {
        await createProfile(detail);
      } else {
        await updateProfile(detail.name, detail);
      }
      setCreating(false);
      setEditing(null);
      await loadTeams();
    } catch {
      setError("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const editorDetail = creating ? createBlankProfileDetail() : editing;
  const showEditor = creating || editing !== null;

  useEffect(() => {
    if (!showEditor) return;
    setManagementOpen(true);
  }, [showEditor]);

  const openVillage = (template: TeamTemplate) => {
    setSpotlightTemplateId(template.id);
    setVillageTemplate(template);
  };

  const selectSpotlight = (template: TeamTemplate) => {
    setSpotlightTemplateId(template.id);
  };

  if (loading) {
    return (
      <div className="panel-container">
        <div className="panel-loading">
          <Loader size={20} className="spin-icon" />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="panel-container">
        <div className="panel-header">
          <Users size={16} />
          <h3>团队小镇</h3>
          <button
            className="panel-refresh-btn"
            onClick={() => void loadTeams()}
            title="刷新"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {error && <div className="panel-error">{error}</div>}

        <TeamStage
          templates={templates}
          activeTemplate={activeTemplate}
          spotlightTemplate={spotlightTemplate}
          managementOpen={managementOpen}
          launchingTemplate={launchingTemplate}
          onToggleManagement={() => setManagementOpen((current) => !current)}
          onOpenVillage={openVillage}
          onSelectSpotlight={selectSpotlight}
          onLaunchTeam={(template) => void handleLaunchTeam(template)}
        />

        <TeamManagementPanel
          managementOpen={managementOpen}
          showEditor={showEditor}
          editorDetail={editorDetail}
          creating={creating}
          saving={saving}
          deleting={deleting}
          presets={presets}
          profiles={profiles}
          templates={templates}
          activeSessionKey={activeSessionKey}
          launchingTemplate={launchingTemplate}
          onManagementToggle={setManagementOpen}
          onCreate={handleCreate}
          onSave={(detail) => void handleSave(detail)}
          onCancelEdit={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSwitchTeam={onSwitchTeam}
          onEditProfile={(name) => void handleEdit(name)}
          onDeleteProfile={(name) => void handleDelete(name)}
          onLaunchTeam={(template) => void handleLaunchTeam(template)}
          onOpenVillage={openVillage}
        />
      </div>

      {villageTemplate && (
        <Suspense
          fallback={<div className="village-loading">正在搭建协作小镇…</div>}
        >
          <VillageScene
            template={villageTemplate}
            activeSessionKey={activeSessionKey}
            onBack={() => setVillageTemplate(null)}
            onLaunchTeam={handleLaunchTeam}
          />
        </Suspense>
      )}
    </>
  );
}
