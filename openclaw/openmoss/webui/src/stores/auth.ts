import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { adminApi } from '@/api/client'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('admin_token'))

  const isAuthenticated = computed(() => !!token.value)

  async function login(password: string) {
    const { data } = await adminApi.login(password)
    token.value = data.token
    localStorage.setItem('admin_token', data.token)
    return data
  }

  function logout() {
    token.value = null
    localStorage.removeItem('admin_token')
  }

  return { token, isAuthenticated, login, logout }
})
