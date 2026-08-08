<template>
  <div>
    <h2>账号管理</h2>
    <el-table :data="users" border stripe size="small">
      <el-table-column prop="displayName" label="姓名" width="120"/>
      <el-table-column prop="username" label="账号" width="150"/>
      <el-table-column label="角色" width="120">
        <template #default="{row}">
          <el-select v-model="row.role" size="small" @change="chRole(row)">
            <el-option label="查看者" value="viewer"/>
            <el-option label="采购员" value="purchaser"/>
            <el-option label="经理" value="manager"/>
            <el-option label="管理员" value="admin"/>
          </el-select>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{row}"><el-tag :type="row.status==='active'?'success':row.status==='pending'?'warning':'danger'" size="small">{{ row.status==='active'?'已启用':row.status==='pending'?'待审核':'已停用' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="注册时间" width="180">
        <template #default="{row}">{{ row.createdAt ? new Date(row.createdAt).toLocaleString() : '' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120">
        <template #default="{row}">
          <el-button v-if="row.status==='active'" size="small" type="danger" @click="chStatus(row,'disabled')">停用</el-button>
          <el-button v-else size="small" type="success" @click="chStatus(row,'active')">启用</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
const users = ref([])
async function load() { try { const {data} = await axios.get('/api/users'); users.value = data.users||[] } catch(_){} }
async function chRole(row) { try { await axios.patch('/api/users/'+row.id+'/role?role='+row.role); ElMessage.success('角色已更新') } catch(_){} }
async function chStatus(row, s) { try { await axios.patch('/api/users/'+row.id+'/status?status='+s); load() } catch(_){} }
onMounted(load)
</script>
