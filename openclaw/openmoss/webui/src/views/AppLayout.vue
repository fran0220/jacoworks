<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard,
  ListTodo,
  Users,
  Trophy,
  ScrollText,
  FileSearch,
  LogOut,
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const menuItems = [
  { title: '仪表盘', icon: LayoutDashboard, path: '/dashboard' },
  { title: '任务管理', icon: ListTodo, path: '/tasks' },
  { title: 'Agent', icon: Users, path: '/agents' },
  { title: '积分排行', icon: Trophy, path: '/scores' },
  { title: '活动日志', icon: ScrollText, path: '/logs' },
  { title: '审查记录', icon: FileSearch, path: '/reviews' },
]

function handleLogout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <SidebarProvider>
    <Sidebar>
      <SidebarHeader class="p-4">
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
            M
          </div>
          <div>
            <div class="font-semibold text-sm">OpenMOSS</div>
            <div class="text-xs text-muted-foreground">管理控制台</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>导航</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in menuItems" :key="item.path">
                <SidebarMenuButton
                  as-child
                  :is-active="route.path === item.path"
                >
                  <router-link :to="item.path">
                    <component :is="item.icon" />
                    <span>{{ item.title }}</span>
                  </router-link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter class="p-4">
        <Button variant="ghost" class="w-full justify-start gap-2" @click="handleLogout">
          <LogOut class="h-4 w-4" />
          退出登录
        </Button>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset>
      <header class="flex h-14 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <Separator orientation="vertical" class="h-4" />
        <h1 class="text-sm font-medium">
          {{ menuItems.find(i => i.path === route.path)?.title ?? 'OpenMOSS' }}
        </h1>
      </header>

      <main class="flex-1 p-6">
        <router-view />
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
