<template>
  <div>
    <h2 style="margin-bottom:20px">工作台</h2>
    <div class="dashboard-cards">
      <div class="stat-card" v-for="c in cards" @click="$router.push(c.to)">
        <div class="count">{{ c.count }}</div>
        <div class="label">{{ c.label }}</div>
      </div>
    </div>
    <el-row :gutter="16">
      <el-col :span="12">
        <el-card header="整体填写进度">
          <el-progress :percentage="fillPct" :stroke-width="12"/>
          <div style="margin-top:8px;color:#7f8c8d;font-size:13px">{{ filledItems }}/{{ totalItems }} 项已填写</div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card header="最近任务">
          <div v-for="t in recentTasks" :key="t.id" style="padding:8px 0;border-bottom:1px solid #f0f0f0;cursor:pointer" @click="$router.push('/tasks/'+t.id)">
            <el-tag :type="statusType(t.status)" size="small">{{ statusLabel(t.status) }}</el-tag>
            <strong style="margin-left:8px">{{ t.title }}</strong>
            <span v-if="t.deadline" :class="deadlineClass(t.deadline)" style="float:right;font-size:12px">{{ new Date(t.deadline).toLocaleDateString() }}</span>
          </div>
          <div v-if="recentTasks.length===0" style="text-align:center;color:#999;padding:20px">暂无进行中的任务</div>
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
    { label:'进行中', count: t.filter(i=>['published','in_progress'].includes(i.status)).length, to:'/tasks' },
    { label:'待审核', count: t.filter(i=>i.status==='review').length, to:'/tasks' },
    { label:'已完成', count: t.filter(i=>i.status==='completed').length, to:'/tasks' },
    { label:'近期待办', count: t.filter(i=>i.deadline&&new Date(i.deadline)<new Date(Date.now()+86400000)&&i.status!=='completed').length, to:'/tasks' },
  ]
})
function statusLabel(s){ return {published:'已下发',in_progress:'进行中',review:'待审核',completed:'已完成'}[s]||s }
function statusType(s){ return {published:'info',in_progress:'',review:'warning',completed:'success'}[s]||'' }
function deadlineClass(d){ const dt=new Date(d); if(dt<new Date())return 'task-deadline-late'; if(dt<new Date(Date.now()+86400000))return 'task-deadline-soon'; return '' }
onMounted(async ()=>{
  try {
    const [tr,sr] = await Promise.all([axios.get('/api/tasks'), axios.get('/api/tasks/stats')])
    tasks.value = tr.data.tasks || []
    totalItems.value = sr.data.totalItems
    filledItems.value = sr.data.filledItems
  } catch(_){}
})
</script>
