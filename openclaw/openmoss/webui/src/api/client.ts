import axios from 'axios'
import { useAuthStore } from '@/stores/auth'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000,
})

// 请求拦截器：自动附加 Admin Token
api.interceptors.request.use((config) => {
  const auth = useAuthStore()
  if (auth.token) {
    config.headers['X-Admin-Token'] = auth.token
  }
  return config
})

// 响应拦截器：处理 403 自动跳转登录（排除登录接口本身）
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 403 && !error.config?.url?.includes('/admin/login')) {
      const auth = useAuthStore()
      auth.logout()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

export default api

export interface AdminPageResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages: number
  has_more: boolean
}

export interface AdminTaskItem {
  id: string
  name: string
  description: string
  type: string
  status: string
  module_count: number
  sub_task_count: number
  pending_count: number
  assigned_count: number
  in_progress_count: number
  review_count: number
  rework_count: number
  blocked_count: number
  done_count: number
  cancelled_count: number
  created_at: string | null
  updated_at: string | null
}

export type AdminTaskDetail = AdminTaskItem

export interface AdminModuleItem {
  id: string
  task_id: string
  name: string
  description: string
  sub_task_count: number
  pending_count: number
  assigned_count: number
  in_progress_count: number
  review_count: number
  rework_count: number
  blocked_count: number
  done_count: number
  cancelled_count: number
  created_at: string | null
}

export interface AdminSubTaskItem {
  id: string
  task_id: string
  task_name: string
  module_id: string | null
  module_name: string | null
  name: string
  description: string
  type: string
  status: string
  priority: string
  assigned_agent: string | null
  assigned_agent_name: string | null
  current_session_id: string | null
  rework_count: number
  created_at: string | null
  updated_at: string | null
  completed_at: string | null
}

export interface AdminSubTaskDetail extends AdminSubTaskItem {
  deliverable: string
  acceptance: string
}

export interface AdminTaskListParams {
  page?: number
  page_size?: number
  status?: string
  type?: string
  keyword?: string
  sort_by?: string
  sort_order?: string
}

export interface AdminModuleListParams {
  page?: number
  page_size?: number
  sort_by?: string
  sort_order?: string
}

export interface AdminSubTaskListParams {
  page?: number
  page_size?: number
  module_id?: string
  status?: string
  assigned_agent?: string
  priority?: string
  type?: string
  keyword?: string
  sort_by?: string
  sort_order?: string
}

// ============================================================
// API 模块
// ============================================================

export const adminApi = {
  login: (password: string) => api.post('/admin/login', { password }),
  resetKey: (agentId: string) => api.post(`/admin/agents/${agentId}/reset-key`),
}

export const adminTaskApi = {
  list: (params?: AdminTaskListParams) =>
    api.get<AdminPageResponse<AdminTaskItem>>('/admin/tasks', { params }),
  get: (id: string) => api.get<AdminTaskDetail>(`/admin/tasks/${id}`),
  listModules: (taskId: string, params?: AdminModuleListParams) =>
    api.get<AdminPageResponse<AdminModuleItem>>(`/admin/tasks/${taskId}/modules`, { params }),
  listSubTasks: (taskId: string, params?: AdminSubTaskListParams) =>
    api.get<AdminPageResponse<AdminSubTaskItem>>(`/admin/tasks/${taskId}/sub-tasks`, { params }),
  getSubTask: (subTaskId: string) => api.get<AdminSubTaskDetail>(`/admin/sub-tasks/${subTaskId}`),
}

export const taskApi = {
  list: (params?: { page?: number; page_size?: number; status?: string }) =>
    api.get('/tasks', { params }),
  get: (id: string) => api.get(`/tasks/${id}`),
  create: (data: { name: string; description?: string; type?: string }) => api.post('/tasks', data),
  update: (id: string, data: { name?: string; description?: string }) =>
    api.put(`/tasks/${id}`, data),
  updateStatus: (id: string, status: string) => api.put(`/tasks/${id}/status`, { status }),
  cancel: (id: string) => api.delete(`/tasks/${id}`),
}

export const subTaskApi = {
  list: (params?: { task_id?: string; status?: string; page?: number; page_size?: number }) =>
    api.get('/sub-tasks', { params }),
  get: (id: string) => api.get(`/sub-tasks/${id}`),
}

export const agentApi = {
  list: (params?: { role?: string }) => api.get('/agents', { params }),
  get: (id: string) => api.get(`/agents/${id}`),
}

export const scoreApi = {
  leaderboard: () => api.get('/scores/leaderboard'),
  agentScore: (agentId: string) => api.get(`/scores/${agentId}`),
  agentLogs: (agentId: string, params?: { page?: number; page_size?: number }) =>
    api.get(`/scores/${agentId}/logs`, { params }),
  adjust: (data: { agent_id: string; score_delta: number; reason: string; sub_task_id?: string }) =>
    api.post('/scores/adjust', data),
}

export const reviewApi = {
  list: (params?: { sub_task_id?: string; page?: number; page_size?: number }) =>
    api.get('/review-records', { params }),
  get: (id: string) => api.get(`/review-records/${id}`),
}

export const logApi = {
  list: (params?: { sub_task_id?: string; action?: string; days?: number; limit?: number }) =>
    api.get('/logs', { params }),
}

export const ruleApi = {
  list: (params?: { task_id?: string; sub_task_id?: string }) => api.get('/rules', { params }),
}

export const feedApi = {
  status: () => api.get('/feed/status'),
  logs: (params?: { after?: string; agent_id?: string; limit?: number }) =>
    api.get('/feed/logs', { params }),
  agents: () => api.get('/feed/agents'),
  agentSummary: () => api.get('/feed/agent-summary'),
}
