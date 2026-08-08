<template>
  <div>
    <el-button text @click="$router.push('/tasks')">← 返回任务列表</el-button>
    <el-card style="margin-top:12px">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="color:#999;font-size:12px">{{ task.taskNo }}</span>
            <h3 style="margin:4px 0">{{ task.title }}</h3>
          </div>
          <el-tag :type="statusType(task.status)">{{ statusLabel(task.status) }}</el-tag>
        </div>
      </template>
      <el-descriptions :column="4" border size="small">
        <el-descriptions-item label="请求人">{{ task.requester || '未填写' }}</el-descriptions-item>
        <el-descriptions-item label="国家">{{ task.country || '未填写' }}</el-descriptions-item>
        <el-descriptions-item label="客户">{{ task.clientName || '未填写' }}</el-descriptions-item>
        <el-descriptions-item label="截止时间">{{ task.deadline ? new Date(task.deadline).toLocaleString() : '未设置' }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-tabs v-model="activeTab" style="margin-top:16px">
      <el-tab-pane label="询价填写" name="entry">
        <el-button size="small" @click="loadData">刷新数据</el-button>
        <el-table :data="items" border stripe size="small" style="margin-top:12px">
          <el-table-column prop="lineNo" label="#" width="50"/>
          <el-table-column prop="description" label="产品描述" min-width="200" show-overflow-tooltip/>
          <el-table-column prop="productCode" label="代码" width="100"/>
          <el-table-column prop="quantity" label="数量" width="80"/>
          <el-table-column prop="unit" label="单位" width="60"/>
          <el-table-column label="FOB(USD)" width="120">
            <template #default="{row}">
              <el-input v-model="row._fobUsd" size="small" placeholder="0.00" @change="row._dirty=true"/>
            </template>
          </el-table-column>
          <el-table-column label="备注" width="150">
            <template #default="{row}">
              <el-input v-model="row._remarks" size="small" placeholder="备注" @change="row._dirty=true"/>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160">
            <template #default="{row}">
              <el-button v-if="row._dirty" type="primary" size="small" @click="saveRow(row)" :loading="row._saving">保存</el-button>
              <el-button size="small" @click="revertRow(row)">还原</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div style="margin-top:16px">
          <el-button v-if="auth.user?.role==='admin'" type="success" @click="snapshotTask">审核通过保存快照</el-button>
          <el-button v-else type="success" @click="submitReview">提交负责人审核</el-button>
        </div>
      </el-tab-pane>

      <el-tab-pane label="讨论" name="comments">
        <div v-for="c in comments" :key="c.id" style="padding:8px 0;border-bottom:1px solid #f0f0f0">
          <strong style="color:#4472c4">{{ c.userName }}</strong>
          <span style="margin-left:8px">{{ c.content }}</span>
          <div style="font-size:11px;color:#999">{{ c.createdAt ? new Date(c.createdAt).toLocaleString() : '' }}</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <el-input v-model="commentText" placeholder="输入评论…" @keyup.enter="addComment"/>
          <el-button type="primary" @click="addComment">发送</el-button>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { useAuthStore } from '../stores/auth'
import { ElMessage } from 'element-plus'
const auth = useAuthStore()
const route = useRoute()
const task = ref({})
const items = ref([])
const comments = ref([])
const commentText = ref('')
const activeTab = ref('entry')

function statusLabel(s){ return {published:'已下发',in_progress:'进行中',review:'待审核',completed:'已完成'}[s]||s }
function statusType(s){ return {published:'info',in_progress:'',review:'warning',completed:'success'}[s]||'' }

async function loadData() {
  const { data } = await axios.get(`/api/tasks/${route.params.id}`)
  task.value = data.task
  items.value = (data.items||[]).map(i=>({...i, _fobUsd:i.fobUsd??'', _remarks:i.remarks||'', _dirty:false, _saving:false}))
  try { const r = await axios.get(`/api/tasks/${route.params.id}/comments`); comments.value = r.data.comments||[] } catch(_){}
}
async function saveRow(row) {
  row._saving = true
  try {
    await axios.patch(`/api/tasks/${route.params.id}/items/${row.id}`, {
      fobUsd: parseFloat(row._fobUsd)||null, remarks: row._remarks||null, rowVersion: row.rowVersion
    })
    row._dirty = false; row.fobUsd = parseFloat(row._fobUsd)
    ElMessage.success('已保存')
  } catch(e) { ElMessage.error(e.response?.data?.detail||'保存失败') } finally { row._saving = false }
}
async function revertRow(row) {
  try { await axios.post(`/api/tasks/${route.params.id}/items/${row.id}/revert`); await loadData(); ElMessage.success('已还原') } catch(e){}
}
async function addComment() {
  if (!commentText.value.trim()) return
  try { await axios.post(`/api/tasks/${route.params.id}/comments?content=${encodeURIComponent(commentText.value.trim())}`); commentText.value=''; await loadData() } catch(_){}
}
async function submitReview() {
  try { await axios.post(`/api/tasks/${route.params.id}/submit-review`); ElMessage.success('已提交审核') } catch(_){}
}
async function snapshotTask() {
  try { await axios.post(`/api/tasks/${route.params.id}/snapshots`); ElMessage.success('快照已保存') } catch(_){}
}
onMounted(loadData)
</script>
