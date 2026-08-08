import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(JSON.parse(localStorage.getItem('latic_user') || 'null'))
  const token = ref(localStorage.getItem('latic_token') || '')
  const isLoggedIn = computed(() => !!token.value)

  async function login(form) {
    const { data } = await axios.post('/api/auth/login', form)
    token.value = data.token
    user.value = data.user
    localStorage.setItem('latic_token', data.token)
    localStorage.setItem('latic_user', JSON.stringify(data.user))
    axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`
    return data
  }

  async function logout() {
    token.value = ''
    user.value = null
    localStorage.removeItem('latic_token')
    localStorage.removeItem('latic_user')
    delete axios.defaults.headers.common['Authorization']
  }

  async function restoreSession() {
    if (!token.value) return false
    try {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token.value}`
      const { data } = await axios.get('/api/auth/me')
      user.value = data.user
      return true
    } catch { logout(); return false }
  }

  if (token.value) axios.defaults.headers.common['Authorization'] = `Bearer ${token.value}`

  return { user, token, isLoggedIn, login, logout, restoreSession }
})
