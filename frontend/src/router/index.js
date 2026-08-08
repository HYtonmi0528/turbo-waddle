import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'Dashboard', component: () => import('../views/Dashboard.vue') },
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue') },
  { path: '/tasks', name: 'Tasks', component: () => import('../views/Tasks.vue') },
  { path: '/tasks/:id', name: 'TaskDetail', component: () => import('../views/TaskDetail.vue') },
  { path: '/templates', name: 'Templates', component: () => import('../views/Templates.vue') },
  { path: '/admin', name: 'Admin', component: () => import('../views/Admin.vue'), meta: { role: 'admin' } },
  { path: '/database', name: 'Database', component: () => import('../views/Database.vue') },
  { path: '/excel', name: 'Excel', component: () => import('../views/Excel.vue') },
]

const router = createRouter({ history: createWebHashHistory(), routes })
export default router
