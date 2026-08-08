<template>
  <div>
    <h2 style="margin-bottom:24px;font-size:22px;font-weight:700">工作台</h2>
    <div class="card-stats">
      <div class="stat-card" v-for="c in cards" :key="c.label" @click="$router.push(c.to)">
        <div class="stat-icon" :style="{background:c.bg+'20',color:c.bg}">{{ c.icon }}</div>
        <div class="stat-count" :style="{color:c.bg}">{{ c.count }}</div>
        <div class="stat-label">{{ c.label }}</div>
      </div>
    </div>
    <el-row :gutter="16">
      <el-col :span="12">
        <el-card header="整体填写进度" shadow="never">
          <div style="display:flex;align-items:center;gap:16px">
            <div style="flex:1"><el-progress :percentage="fillPct" :stroke-width="14" color="var(--brand)"/></div>
            <span style="font-size:24px;font-weight:700;color:var(--brand)">{{ fillPct }}%</span>
          </div>
          <div style="margin-top:8px;color:var(--text-secondary);font-size:13px">{{ filledItems }}/{{ totalItems }} 项已填写</div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card header="最近任务" shadow="never">
          <div v-for="t in recentTasks" :key="t.id" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" @click="$router.push('/tasks/'+t.id)">
            <el-tag :type="t.status==='review'?'warning':t.status==='completed'?'success':t.status==='published'?'info':''" size="small">{{ statusLabel(t.status) }}</el-tag>
            <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ t.title }}</span>
            <span v-if="t.deadline" :style="{fontSize:'11px',color:new Date(t.deadline)<new Date()?'var(--danger)':new Date(t.deadline)<new Date(Date.now()+86400000)?'var(--warning)':'var(--text-secondary)'}">{{ new Date(t.deadline).toLocaleDateString() }}</span>
          </div>
          <div v-if="recentTasks.length===0" style="text-align:center;color:var(--text-secondary);padding:30px">暂无进行中的任务</div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
<script setup>
import { ref, onMounted, computed } from 'vue'
import axios from 'axios'
const tasks = ref([])
const totalItems = ref(0)
const filledItems = ref(0)
const fillPct = computed(() => totalItems.value ? Math.round(filledItems.value/totalItems.value*100) : 0)
const recentTasks = computed(() => tasks.value.filter(t=>t.status!=='completed').slice(0,5))
const cards = computed(() => {
  const t = tasks.value
  return [
    { label:'进行中', count:t.filter(i=>['published','in_progress'].includes(i.status)).length, to:'/tasks', bg:'#3b6cb4', icon:'📋' },
    { label:'待审核', count:t.filter(i=>i.status==='review').length, to:'/tasks', bg:'#f39c12', icon:'⏳' },
    { label:'已完成', count:t.filter(i=>i.status==='completed').length, to:'/tasks', bg:'#27ae60', icon:'✅' },
    { label:'临期待办', count:t.filter(i=>i.deadline&&new Date(i.deadline)<new Date(Date.now()+86400000)&&i.status!=='completed').length, to:'/tasks', bg:'#e74c3c', icon:'🔥' },
  ]
})
function statusLabel(s){ return {published:'已下发',in_progress:'进行中',review:'待审核',completed:'已完成'}[s]||s }
onMounted(async ()=>{
  try { const [tr,sr]=await Promise.all([axios.get('/api/tasks'),axios.get('/api/tasks/stats')]); tasks.value=tr.data.tasks||[]; totalItems.value=sr.data.totalItems; filledItems.value=sr.data.filledItems } catch(_){}
})
</script>
