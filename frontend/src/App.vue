<template>
  <div v-if="!auth.isLoggedIn" class="login-shell"><Login /></div>
  <el-container v-else style="height:100vh">
    <el-aside width="220px">
      <div style="padding:16px;color:#fff;font-weight:600;font-size:15px;text-align:center">LATIC 询价协作</div>
      <el-menu :default-active="route.path" router background-color="transparent" text-color="#ccc" active-text-color="#fff">
        <el-menu-item index="/"><el-icon><DataAnalysis /></el-icon>工作台</el-menu-item>
        <el-menu-item index="/tasks"><el-icon><List /></el-icon>共享询价任务</el-menu-item>
        <el-menu-item index="/templates"><el-icon><Files /></el-icon>模板管理</el-menu-item>
        <el-menu-item index="/excel"><el-icon><Document /></el-icon>Excel工具</el-menu-item>
        <el-menu-item v-if="auth.user?.role==='admin'" index="/admin"><el-icon><UserFilled /></el-icon>账号管理</el-menu-item>
        <el-menu-item index="/database"><el-icon><Coin /></el-icon>数据库</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <header class="shell-header">
        <div class="header-brand">LATIC询价协作系统 v2.1.0</div>
        <el-input v-model="search" class="header-search" placeholder="搜索任务/产品/供应商..." size="small" clearable @clear="search=''">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <div style="display:flex;align-items:center;gap:12px">
          <el-badge :value="unread" :hidden="!unread"><el-button circle :icon="Bell" @click=""/></el-badge>
          <span>{{ auth.user?.displayName }}</span>
          <el-tag size="small">{{ roleLabel(auth.user?.role) }}</el-tag>
          <el-button size="small" text @click="doLogout">退出</el-button>
        </div>
      </header>
      <el-main style="background:#f5f6fa;padding:20px"><router-view /></el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { Document, List, Files, Search, Bell, DataAnalysis, UserFilled, Coin } from '@element-plus/icons-vue'
import Login from './views/Login.vue'
import axios from 'axios'
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const search = ref('')
const unread = ref(0)
function roleLabel(r) { return {admin:'管理员',manager:'经理',purchaser:'采购员',viewer:'查看者'}[r]||r }
async function doLogout() { await auth.logout(); router.push('/login') }
onMounted(async () => {
  if (auth.token) {
    const ok = await auth.restoreSession()
    if (!ok) router.push('/login')
  }
})
</script>
