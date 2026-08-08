<template>
  <div>
    <h2>数据库浏览器</h2>
    <el-row :gutter="12">
      <el-col :span="6">
        <el-card header="表列表" style="max-height:calc(100vh - 160px);overflow-y:auto">
          <div v-for="t in tables" :key="t.name" style="padding:6px 10px;cursor:pointer;border-radius:4px" :style="{background:selectedTable===t.name?'#e6f0ff':'',marginBottom:'2px'}" @click="selectTable(t.name)">
            <span>{{ t.name }}</span>
            <span style="float:right;color:#999;font-size:11px">{{ t.rowCount }}</span>
          </div>
        </el-card>
      </el-col>
      <el-col :span="18">
        <el-card>
          <template #header><strong>{{ selectedTable || '请选择表' }}</strong><span v-if="totalRows" style="margin-left:12px;color:#999;font-size:12px">{{ totalRows }} 行 · {{ columns.length }} 列</span></template>
          <el-input v-model="sql" type="textarea" :rows="2" placeholder="SELECT * FROM rfq_tasks LIMIT 10" size="small" style="margin-bottom:10px"/>
          <el-button size="small" @click="runQuery">执行查询</el-button>
          <el-table v-if="rows.length && columns.length" :data="rows" border stripe size="small" max-height="500" style="margin-top:10px">
            <el-table-column v-for="c in columns" :key="c" :prop="c" :label="c" min-width="150" show-overflow-tooltip>
              <template #default="{row}">{{ row[c] === null ? 'NULL' : typeof row[c] === 'object' ? JSON.stringify(row[c]) : String(row[c]) }}</template>
            </el-table-column>
          </el-table>
          <el-pagination v-if="totalRows > 100" :total="totalRows" :page-size="100" layout="prev,pager,next" @current-change="selectTable(selectedTable, $event-1)" style="margin-top:12px"/>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
const tables = ref([])
const selectedTable = ref('')
const columns = ref([])
const rows = ref([])
const totalRows = ref(0)
const sql = ref('')
async function loadTables() { try { const {data} = await axios.get('/api/db/tables'); tables.value = data||[] } catch(_){} }
async function selectTable(name, page=0) {
  selectedTable.value = name; sql.value = ''
  try { const {data} = await axios.get('/api/db/table/'+name+'?page='+page+'&pageSize=100'); columns.value=data.columns||[]; rows.value=data.rows||[]; totalRows.value=data.total||0 } catch(e){ ElMessage.error('查询失败') }
}
async function runQuery() {
  if (!sql.value.trim()) return
  try { const {data} = await axios.post('/api/db/query', { query: sql.value }); columns.value=data.columns||[]; rows.value=data.rows||[]; totalRows.value=data.total||0; selectedTable.value='' } catch(e){ ElMessage.error(e.response?.data?.detail||'查询失败') }
}
onMounted(loadTables)
</script>
