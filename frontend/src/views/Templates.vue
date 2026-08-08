<template>
  <div>
    <h2>模板管理</h2>
    <el-tabs v-model="tab">
      <el-tab-pane label="我的模板" name="mine">
        <div style="margin-bottom:12px">
          <el-upload :show-file-list="false" :auto-upload="false" accept=".xlsx" :on-change="uploadTpl" action="#">
            <el-button type="primary">导入Excel模板</el-button>
          </el-upload>
        </div>
        <el-table :data="templates" border stripe size="small">
          <el-table-column prop="name" label="名称" min-width="180"/>
          <el-table-column prop="type" label="类型" width="100"/>
          <el-table-column prop="description" label="说明" min-width="150"/>
          <el-table-column label="共享" width="80">
            <template #default="{row}"><el-tag :type="row.isShared?'success':''" size="small">{{ row.isShared ? '已共享' : '个人' }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="220">
            <template #default="{row}">
              <el-button size="small" @click="toggleShare(row)">{{ row.isShared ? '取消共享' : '共享' }}</el-button>
              <el-button size="small" type="danger" @click="delTpl(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="!templates.length" style="text-align:center;color:#999;padding:40px">暂无模板，请导入Excel模板</div>
      </el-tab-pane>
      <el-tab-pane label="团队共享模板" name="shared">
        <el-table :data="shared" border stripe size="small">
          <el-table-column prop="name" label="名称" min-width="180"/>
          <el-table-column prop="type" label="类型" width="100"/>
          <el-table-column prop="ownerName" label="所有者" width="120"/>
          <el-table-column label="操作" width="120">
            <template #default="{row}">
              <el-button size="small" @click="copyTpl(row)">复制到我的</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="!shared.length" style="text-align:center;color:#999;padding:40px">暂无共享模板</div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
const tab = ref('mine')
const templates = ref([])
const shared = ref([])
async function load() {
  try { const {data} = await axios.get('/api/mytemplates'); templates.value = data.templates||[] } catch(_){}
  try { const {data} = await axios.get('/api/templates/shared'); shared.value = Array.isArray(data) ? data : [] } catch(_){}
}
async function uploadTpl(file) {
  const fd = new FormData(); fd.append('file', file.raw)
  try { await axios.post('/api/templates/import', fd); ElMessage.success('导入成功'); load() } catch(e) { ElMessage.error(e.response?.data?.detail||'导入失败') }
}
async function toggleShare(row) {
  try { await axios.post('/api/templates', { id: row.id, name: row.name, type: row.type, description: row.description, isShared: !row.isShared }); load(); ElMessage.success('已更新') } catch(_){}
}
async function delTpl(row) {
  await ElMessageBox.confirm('确定删除模板？', '确认', { type: 'warning' })
  try { await axios.delete('/api/mytemplates/'+row.id); load() } catch(_){}
}
async function copyTpl(row) {
  try { await axios.post('/api/templates/'+row.id+'/duplicate'); load(); ElMessage.success('已复制') } catch(_){}
}
onMounted(load)
</script>
