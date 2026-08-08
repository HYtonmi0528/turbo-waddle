<template>
  <div style="display:flex;justify-content:center;align-items:center;height:100vh;background:linear-gradient(135deg,#667eea,#764ba2)">
    <el-card style="width:420px">
      <h2 style="text-align:center;margin-bottom:20px">登录询价协作系统</h2>
      <el-tabs v-model="entrance">
        <el-tab-pane label="员工入口" name="employee"/>
        <el-tab-pane label="管理员入口" name="admin"/>
      </el-tabs>
      <el-form @submit.prevent="doLogin">
        <el-form-item>
          <el-input v-model="form.username" placeholder="账号" prefix-icon="User" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" prefix-icon="Lock" show-password />
        </el-form-item>
        <el-form-item v-if="registerMode">
          <el-input v-model="form.displayName" placeholder="姓名" />
          <el-select v-model="form.role" style="width:100%;margin-top:8px" placeholder="角色">
            <el-option label="查看者（只读）" value="viewer"/>
            <el-option label="采购员（录入）" value="purchaser"/>
            <el-option label="经理（审批）" value="manager"/>
            <el-option label="管理员" value="admin"/>
          </el-select>
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="loading" style="width:100%">
          {{ registerMode ? '注册' : '登录' }}
        </el-button>
      </el-form>
      <div style="text-align:center;margin-top:12px">
        <el-button link @click="registerMode=!registerMode">{{ registerMode ? '← 返回登录' : '注册新账号' }}</el-button>
      </div>
      <div v-if="error" style="color:#e74c3c;text-align:center;margin-top:8px">{{ error }}</div>
    </el-card>
  </div>
</template>
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
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
      registerMode.value = false; error.value = ''
      return
    }
    await auth.login({ ...form.value, entrance: entrance.value })
    router.push('/')
  } catch(e) { error.value = e.response?.data?.detail || e.message } finally { loading.value = false }
}
import axios from 'axios'
</script>
