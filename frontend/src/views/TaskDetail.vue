<template>
  <div>
    <el-button text @click="$router.push('/tasks')">← 返回</el-button>
    <el-card style="margin-top:12px">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><span style="color:#999;font-size:12px">{{ task.taskNo }}</span><h3 style="margin:4px 0">{{ task.title }}</h3></div>
          <el-tag>{{ statusLabel(task.status) }}</el-tag>
        </div>
      </template>
      <el-descriptions :column="4" border size="small">
        <el-descriptions-item label="请求人">{{ task.requester||'—' }}</el-descriptions-item>
        <el-descriptions-item label="国家">{{ task.country||'—' }}</el-descriptions-item>
        <el-descriptions-item label="客户">{{ task.clientName||'—' }}</el-descriptions-item>
        <el-descriptions-item label="截止">{{ task.deadline ? new Date(task.deadline).toLocaleDateString() : '—' }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-tabs v-model="activeTab" style="margin-top:16px">
      <el-tab-pane label="填写" name="entry">
        <div style="margin-bottom:10px;display:flex;align-items:center;gap:8px">
          <el-select v-model="quoteSetId" placeholder="供应商报价集" size="small" clearable style="width:200px">
            <el-option v-for="qs in quoteSets" :key="qs.id" :label="qs.name" :value="qs.id"/>
          </el-select>
          <el-input-number v-model="rate" :precision="4" size="small" style="width:120px" placeholder="汇率"/>
          <el-select v-model="invType" size="small" style="width:100px"><el-option label="专票" value="special"/><el-option label="普票" value="regular"/></el-select>
          <el-button size="small" @click="loadData">刷新</el-button>
        </div>
        <el-table :data="items" border stripe size="small">
          <el-table-column prop="lineNo" label="#" width="50"/>
          <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip/>
          <el-table-column prop="quantity" label="数量" width="80"/>
          <el-table-column label="供应商" width="140">
            <template #default="{row}">
              <span v-if="row.selectedSupplier"><strong>{{ row.selectedSupplier }}</strong></span>
              <el-button v-else size="small" @click="openCandidates(row)">从表格勾选</el-button>
            </template>
          </el-table-column>
          <el-table-column prop="totalRmb" label="含税RMB" width="110"/>
          <el-table-column label="FOB" width="110">
            <template #default="{row}"><el-input v-model="row._fobUsd" size="small" @change="row._dirty=true"/></template>
          </el-table-column>
          <el-table-column label="备注" width="130">
            <template #default="{row}"><el-input v-model="row._remarks" size="small" @change="row._dirty=true"/></template>
          </el-table-column>
          <el-table-column label="附件" width="100">
            <template #default="{row}">
              <el-upload :show-file-list="false" :auto-upload="false" :on-change="f=>uploadAttachment(row,f)">
                <el-button size="small">＋附件</el-button>
              </el-upload>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140">
            <template #default="{row}">
              <el-button v-if="row._dirty" type="primary" size="small" @click="saveRow(row)">保存</el-button>
              <el-button size="small" @click="revertRow(row)">还原</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-dialog v-model="candidateVisible" title="选择供应商" width="700px">
          <el-table :data="candidates" border size="small" max-height="400">
            <el-table-column label="" width="60"><template #default="{row,$index}">
              <el-button size="small" type="primary" @click="applyCandidate(row)">选用</el-button>
            </template></el-table-column>
            <el-table-column prop="supplierName" label="供应商" width="150"/>
            <el-table-column prop="model" label="型号" width="150"/>
            <el-table-column prop="totalRmb" label="含税RMB" width="110"/>
            <el-table-column prop="notes" label="备注" min-width="120"/>
          </el-table>
        </el-dialog>
        <div style="margin-top:16px">
          <el-button v-if="auth.user?.role==='admin'" type="success" @click="snapshotTask">审核保存快照</el-button>
          <el-button v-else type="success" @click="submitReview">提交审核</el-button>
        </div>
      </el-tab-pane>
      <el-tab-pane label="讨论" name="comments">
        <div v-for="c in comments" :key="c.id" style="padding:8px 0;border-bottom:1px solid #f0f0f0">
          <strong style="color:#4472c4">{{ c.userName }}</strong> <span>{{ c.content }}</span>
          <div style="font-size:11px;color:#999">{{ c.createdAt ? new Date(c.createdAt).toLocaleString() : '' }}</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <el-input v-model="commentText" placeholder="评论…" @keyup.enter="addComment"/>
          <el-button type="primary" @click="addComment">发送</el-button>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { useAuthStore } from '../stores/auth'
import { ElMessage } from 'element-plus'
const auth = useAuthStore(); const route = useRoute()
const task = ref({}); const items = ref([]); const comments = ref([])
const commentText = ref(''); const activeTab = ref('entry')
const quoteSetId = ref(''); const rate = ref(7.25); const invType = ref('special')
const quoteSets = ref([]); const candidateVisible = ref(false); const candidates = ref([])
const selectedItem = ref(null)
function statusLabel(s){ return {published:'已下发',in_progress:'进行中',review:'待审核',completed:'已完成'}[s]||s }
async function loadData() {
  const {data} = await axios.get('/api/tasks/'+route.params.id)
  task.value = data.task; items.value = (data.items||[]).map(i=>({...i,_fobUsd:i.fobUsd??'',_remarks:i.remarks||'',_dirty:false,_saving:false}))
  try{const r=await axios.get('/api/tasks/'+route.params.id+'/comments');comments.value=r.data.comments||[]}catch(_){}
  try{const q=await axios.get('/api/quotes');const qs=q.data.quoteSets||[];quoteSets.value=qs;if(qs.length){const f=qs[0];quoteSetId.value=f.id;rate.value=f.options?.exchangeRate||7.25;invType.value=f.options?.invoiceType||'special'}}catch(_){}
}
async function saveRow(row){row._saving=true;try{await axios.patch('/api/tasks/'+route.params.id+'/items/'+row.id,{fobUsd:parseFloat(row._fobUsd)||null,remarks:row._remarks||null,rowVersion:row.rowVersion});row._dirty=false;ElMessage.success('保存')}catch(e){ElMessage.error(e.response?.data?.detail||'失败')}finally{row._saving=false}}
async function revertRow(row){try{await axios.post('/api/tasks/'+route.params.id+'/items/'+row.id+'/revert');loadData()}catch(_){}}
async function addComment(){if(!commentText.value.trim())return;try{await axios.post('/api/tasks/'+route.params.id+'/comments?content='+encodeURIComponent(commentText.value.trim()));commentText.value='';loadData()}catch(_){}}
async function submitReview(){try{await axios.post('/api/tasks/'+route.params.id+'/submit-review');ElMessage.success('已提交')}catch(_){}}
async function snapshotTask(){try{await axios.post('/api/tasks/'+route.params.id+'/snapshots');ElMessage.success('快照已保存')}catch(_){}}
async function uploadAttachment(row,file){const fd=new FormData();fd.append('file',file.raw);try{await axios.post('/api/tasks/'+route.params.id+'/items/'+row.id+'/attachments',fd);ElMessage.success('上传成功')}catch(e){ElMessage.error('失败')}}
function openCandidates(row){selectedItem.value=row;const qs=quoteSets.value.find(q=>q.id===quoteSetId.value);if(!qs)return;candidates.value=(qs.batches||[]).flatMap(b=>(b.items||[])).map(i=>({...i,_quoteEntryId:qs.id}));candidateVisible.value=true}
async function applyCandidate(c){const it=selectedItem.value;const rmb=Number(c.totalRmb||0);const fob=rmb/(rate.value||7.25)/(invType.value==='special'?1.13:1);try{await axios.patch('/api/tasks/'+route.params.id+'/items/'+it.id,{fobUsd:fob.toFixed(4),totalRmb:rmb,selectedSupplier:c.supplierName,remarks:c.notes||'',rowVersion:it.rowVersion});candidateVisible.value=false;loadData()}catch(e){ElMessage.error('选用失败')}}
onMounted(loadData)
</script>
