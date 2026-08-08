<template>
  <div>
    <h2>Excel工具</h2>
    <el-row :gutter="16" style="margin-bottom:16px">
      <el-col :span="8"><el-select v-model="selectedTemplate" placeholder="选择模板" clearable style="width:100%" @change="loadTemplate">
        <el-option v-for="t in templates" :key="t.id" :label="t.name" :value="t.id"/>
      </el-select></el-col>
      <el-col :span="4"><el-input-number v-model="exchangeRate" :precision="4" :step="0.01" style="width:100%"/></el-col>
      <el-col :span="4">
        <el-select v-model="invoiceType" style="width:100%">
          <el-option label="专票÷1.13" value="special"/>
          <el-option label="普票" value="regular"/>
        </el-select>
      </el-col>
      <el-col :span="8">
        <el-button type="primary" @click="generateExcel" :disabled="!selectedTemplate">生成并下载Excel</el-button>
        <el-upload :show-file-list="false" :auto-upload="false" accept=".xlsx" :on-change="openExisting" style="display:inline-block;margin-left:8px">
          <el-button>继续编辑已有表格</el-button>
        </el-upload>
      </el-col>
    </el-row>
    <el-card v-if="columns.length">
      <el-table :data="items" border stripe size="small">
        <el-table-column v-for="c in columns" :key="c.colIndex" :prop="c.field" :label="c.name" min-width="120">
          <template #default="{row}">
            <el-input v-model="row[c.field]" size="small"/>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="60">
          <template #default="{$index}"><el-button size="small" type="danger" text @click="items.splice($index,1)">删除</el-button></template>
        </el-table-column>
      </el-table>
      <el-button style="margin-top:12px" @click="items.push({})">+ 添加行</el-button>
    </el-card>
    <div v-if="!columns.length" style="text-align:center;color:#999;padding:60px">请先选择或导入一个模板</div>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
const templates = ref([])
const selectedTemplate = ref('')
const exchangeRate = ref(7.25)
const invoiceType = ref('special')
const columns = ref([])
const items = ref([{}])
onMounted(async () => { try { const {data} = await axios.get('/api/mytemplates'); templates.value = data.templates||[] } catch(_){} })
async function loadTemplate() {
  if (!selectedTemplate.value) return
  try {
    const [{data:s}, {data:m}] = await Promise.all([axios.get('/api/templates/'+selectedTemplate.value+'/structure'), axios.get('/api/templates/'+selectedTemplate.value+'/mappings')])
    columns.value = (s?.columns || []).map(c => ({ colIndex: c.index, name: c.name, field: c.field || c.name }))
    if (!columns.value.length) ElMessage.warning('该模板没有字段信息')
    items.value = [{}]
  } catch(_){}
}
async function generateExcel() {
  const batches = [{ items: items.value }]
  try {
    const resp = await axios.post('/api/excel/generate', { templateId: selectedTemplate.value, batches, options: { exchangeRate: exchangeRate.value, invoiceType: invoiceType.value } }, { responseType: 'blob' })
    const url = URL.createObjectURL(resp.data); const a = document.createElement('a'); a.href=url; a.download='generated.xlsx'; a.click(); URL.revokeObjectURL(url)
  } catch(e) { ElMessage.error(e.response?.data?.detail||'生成失败') }
}
async function openExisting(file) {
  const fd = new FormData(); fd.append('file', file.raw)
  try {
    const {data} = await axios.post('/api/excel/open-existing', fd)
    if (data.success && data.batches) {
      items.value = data.batches.flatMap(b => b.items||[]); columns.value = []; ElMessage.success('已加载')
    } else { ElMessage.info(data.message||'无法读取') }
  } catch(e) { ElMessage.error('读取失败') }
}
</script>
