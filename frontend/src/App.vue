<template>
  <div v-if="showSplash" class="startup-splash">
    <img src="/logo.png" alt="LATIC" @animationend="showSplash=false" />
  </div>
  <div v-else-if="!auth.isLoggedIn" class="login-shell"><Login /></div>
  <el-container v-else style="height:100vh">
    <el-aside width="200px">
      <div style="padding:16px;color:#fff;font-weight:600;font-size:14px;text-align:center">LATIC 询价协作</div>
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
        <div class="header-brand"><img src="/logo.png" />LATIC 询价协作</div>
        <div class="header-search" style="position:relative">
          <el-input v-model="search" placeholder="搜索任务/产品/供应商…" size="small" clearable @clear="search='';searchResults=null" @input="doSearch">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <div v-if="searchResults && (searchResults.tasks?.length||searchResults.items?.length)" class="search-dropdown">
            <div v-for="t in (searchResults.tasks||[]).slice(0,5)" :key="'t'+t.id" class="search-item" @click="search='';$router.push('/tasks/'+t.id);searchResults=null">
              <el-tag size="small">{{t.status}}</el-tag><span style="margin-left:8px">{{t.title}}</span>
            </div>
            <div v-for="i in (searchResults.items||[]).slice(0,5)" :key="'i'+i.id" class="search-item" @click="search='';$router.push('/tasks/'+i.taskId);searchResults=null">
              <span>#{{i.lineNo}}</span><span style="margin-left:8px">{{i.description}}</span>
            </div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <el-popover placement="bottom" :width="300" trigger="click">
            <template #reference><el-badge :value="unread" :hidden="!unread"><el-button circle :icon="Bell"/></el-badge></template>
            <div v-if="notifications.length===0" style="text-align:center;color:#999;padding:20px">暂无通知</div>
            <div v-for="n in notifications.slice(0,10)" :key="n.id" style="padding:8px;border-bottom:1px solid #f0f0f0;cursor:pointer" @click="readNotif(n)">
              <strong>{{n.title}}</strong><br/><span style="font-size:12px;color:#999">{{n.message}}</span>
            </div>
          </el-popover>
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
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { Document, List, Files, Search, Bell, DataAnalysis, UserFilled, Coin } from '@element-plus/icons-vue'
import Login from './views/Login.vue'
import axios from 'axios'
const auth = useAuthStore(); const router = useRouter(); const route = useRoute()
const search = ref(''); const searchResults = ref(null); const unread = ref(0); const notifications = ref([])
const showSplash = ref(true)
let pollTimer = null
function roleLabel(r) { return {admin:'管理员',manager:'经理',purchaser:'采购员',viewer:'查看者'}[r]||r }
async function doLogout() { await auth.logout(); router.push('/login') }
async function doSearch() {
  const q = search.value.trim()
  if (q.length < 2) { searchResults.value = null; return }
  try { const {data} = await axios.get('/api/search?q='+encodeURIComponent(q)); searchResults.value = data } catch(_){ searchResults.value = null }
}
async function pollNotifs() {
  try { const {data} = await axios.get('/api/notifications'); notifications.value = data.notifications||[]; unread.value = notifications.value.filter(n=>!n.isRead).length } catch(_){}
}
async function readNotif(n) { try { await axios.patch('/api/notifications/'+n.id+'/read'); pollNotifs(); if(n.taskId) router.push('/tasks/'+n.taskId) } catch(_){} }
onMounted(async () => {
  if (auth.token) { const ok = await auth.restoreSession(); if (!ok) router.push('/login') }
  pollTimer = setInterval(pollNotifs, 15000); pollNotifs()
})
onUnmounted(() => clearInterval(pollTimer))
</script>

<style>
.search-dropdown { position:absolute;top:100%;left:0;right:0;background:#fff;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.15);z-index:100;max-height:320px;overflow-y:auto }
.search-item { padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:12px;border-bottom:1px solid #f0f0f0 }
.search-item:hover { background:#f4f7fc }
.startup-splash { display:flex;align-items:center;justify-content:center;height:100vh;background:linear-gradient(135deg,#1e2d47,#3a5a8c) }
.startup-splash img { width:200px;animation:laticPulse 2s ease-out forwards }
@keyframes laticPulse { 0%{transform:scale(.8);opacity:0}50%{transform:scale(1.05);opacity:1}100%{transform:scale(1);opacity:1} }
</style>
