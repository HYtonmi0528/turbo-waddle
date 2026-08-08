<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2>共享询价任务</h2>
      <el-button v-if="auth.user?.role==='admin'||auth.user?.role==='manager'" type="primary" @click="dialogVisible=true">＋ 上传并下发询价单</el-button>
    </div>
    <el-dialog v-model="dialogVisible" title="下发新询价任务" width="500px">
      <el-upload drag :auto-upload="false" :on-change="importFile" accept=".xlsx" :show-file-list="false">
        <el-icon :size="40"><UploadFilled /></el-icon>
        <div>点击或拖拽Excel文件</div>
      </el-upload>
    </el-dialog>
    <el-row :gutter="16">
      <el-col v-for="t in tasks" :key="t.id" :span="8" style="margin-bottom:16px">
        <el-card shadow="hover" :body-style="{padding:'16px',cursor:'pointer'}" @click="$router.push('/tasks/'+t.id)" :style="deadlineClass(t.deadline)">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <el-tag :type="statusType(t.status)" size="small">{{ statusLabel(t.status) }}</el-tag>
            <span style="font-size:12px;color:#999">{{ t.taskNo }}</span>
          </div>
          <strong style="display:block;margin:10px 0;font-size:14px">{{ t.title }}</strong>
          <div style="font-size:12px;color:#7f8c8d">
            <span>{{ t.country || '未填写' }}</span>
            <span style="margin-left:8px">请求人:{{ t.requester || '—' }}</span>
          </div>
          <div style="margin-top:8px">
            <el-progress :percentage="t.itemCount?Math.round(t.completedCount/t.itemCount*100):0" :stroke-width="6"/>
          </div>
        </el-card>
      </el-col>
    </el-row>
    <div v-if="tasks.length===0" style="text-align:center;padding:60px;color:#999">暂无询价任务</div>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { useAuthStore } from '../stores/auth'
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
const auth = useAuthStore()
const tasks = ref([])
const dialogVisible = ref(false)
function statusLabel(s){ return {published:'已下发',in_progress:'进行中',review:'待审核',completed:'已完成'}[s]||s }
function statusType(s){ return {published:'info',in_progress:'',review:'warning',completed:'success'}[s]||'' }
function deadlineClass(d){
  if(!d)return'';const dt=new Date(d)
  if(dt<new Date())return'border-left:3px solid #e74c3c'
  if(dt<new Date(Date.now()+86400000))return'border-left:3px solid #f39c12'
  return''
}
async function load() { try { const {data}=await axios.get('/api/tasks'); tasks.value=data.tasks||[] } catch(_){} }
async function importFile(file) {
  const fd = new FormData(); fd.append('file', file.raw)
  try { await axios.post('/api/tasks/import', fd); dialogVisible.value = false; ElMessage.success('导入成功'); load() } catch(e) { ElMessage.error(e.response?.data?.detail||'导入失败') }
}
onMounted(load)
</script>
