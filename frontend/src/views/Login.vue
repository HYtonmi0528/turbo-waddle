<template>
  <div class="login-shell">
    <div class="login-card">
      <div style="text-align:center;margin-bottom:20px">
        <img src="/logo.png" style="width:60px;height:40px;object-fit:contain;border-radius:6px;background:#fff;padding:4px" />
        <h2 style="margin-top:12px">登录询价协作系统</h2>
      </div>
      <el-tabs v-model="entrance" style="margin-bottom:16px">
        <el-tab-pane label="员工入口" name="employee"/>
        <el-tab-pane label="管理员入口" name="admin"/>
      </el-tabs>
      <el-form @submit.prevent="doLogin">
        <el-form-item>
          <el-input v-model="form.username" placeholder="账号" size="large" prefix-icon="User" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" size="large" prefix-icon="Lock" show-password @keyup.enter="doLogin"/>
        </el-form-item>
        <el-form-item v-if="registerMode">
          <el-input v-model="form.displayName" placeholder="姓名" size="large"/>
          <el-select v-model="form.role" style="width:100%;margin-top:8px" size="large" placeholder="选择角色">
            <el-option label="查看者（只读）" value="viewer"/>
            <el-option label="采购员（录入数据）" value="purchaser"/>
            <el-option label="经理（审批）" value="manager"/>
            <el-option label="管理员" value="admin"/>
          </el-select>
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="loading" size="large" style="width:100%;height:44px;font-size:15px">
          {{ registerMode ? '注册' : '登录' }}
        </el-button>
      </el-form>
      <div style="text-align:center;margin-top:16px">
        <el-button link type="primary" @click="registerMode=!registerMode;error=''">{{ registerMode ? '← 返回登录' : '注册新账号' }}</el-button>
      </div>
      <div v-if="error" style="color:var(--danger);text-align:center;margin-top:12px;font-size:13px">{{ error }}</div>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import axios from 'axios'
const auth = useAuthStore()
const router = useRouter()
const entrance = ref('employee')
const registerMode = ref(false)
const loading = ref(false)
const error = ref('')
const form = ref({ username: '', password: '', displayName: '', role: 'viewer' })
async function doLogin() {
  loading.value = true; error.value = ''
  try {
    if (registerMode.value) {
      await axios.post('/api/auth/register', form.value)
      registerMode.value = false
      return
    }
    await auth.login({ ...form.value, entrance: entrance.value })
    router.push('/')
  } catch(e) { error.value = e.response?.data?.detail || e.message } finally { loading.value = false }
}
</script>
