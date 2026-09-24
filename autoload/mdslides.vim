" autoload/mdslides.vim
" Core logic for mdslides: renders the current markdown buffer as a
" reveal.js slide deck (one slide per heading) and live-updates it in the
" browser as you edit.

if !exists('g:mdslides_port')
  " 0 means "pick a free port automatically", so multiple Vim instances can
  " each run their own presentation without colliding on the same port. Set
  " this to a fixed nonzero port if you specifically want a stable URL.
  let g:mdslides_port = 0
endif

if !exists('g:mdslides_follow_cursor')
  " When on, moving the cursor jumps the presentation to whatever slide
  " the cursor is now under (requires `curl` on PATH). Off by default
  " because it makes the cursor the sole driver of slide position -- manual
  " arrow-key navigation in the browser gets overridden on the next move.
  let g:mdslides_follow_cursor = 0
endif

if !exists('g:mdslides_open_browser_cmd')
  if has('mac') || has('macunix')
    let g:mdslides_open_browser_cmd = 'open'
  elseif has('win32') || has('win64')
    let g:mdslides_open_browser_cmd = 'start'
  else
    let g:mdslides_open_browser_cmd = 'xdg-open'
  endif
endif

let s:plugin_root = expand('<sfile>:p:h:h')
let s:app_dir = s:plugin_root . '/app'
let s:job = v:null
let s:tempfile = ''
let s:bufnr = -1
let s:browser_opened = 0
let s:port = 0
let s:cursor_timer = -1

function! s:log(msg) abort
  echom '[mdslides] ' . a:msg
endfunction

function! s:is_running() abort
  if empty(s:job)
    return 0
  endif
  if has('nvim')
    return jobwait([s:job], 0)[0] == -1
  endif
  return job_status(s:job) ==# 'run'
endfunction

function! s:write_buffer_to_temp() abort
  call writefile(getline(1, '$'), s:tempfile)
endfunction

function! s:on_job_exit(...) abort
  let s:job = v:null
endfunction

function! s:try_open_from_output(text) abort
  " The server prints its actual bound URL once it's listening -- actual,
  " because with the default g:mdslides_port of 0 the OS picks a free port,
  " so each concurrent mdslides instance (one per Vim buffer presenting at
  " once) gets its own port instead of colliding on a shared one. Parse it
  " out rather than assuming a URL up front. Keep this pattern in sync with
  " the message app/server.js logs on listen.
  if s:browser_opened
    return
  endif
  let l:m = matchlist(a:text, 'listening on \(http://127\.0\.0\.1:\(\d\+\)/\?\)')
  if empty(l:m)
    return
  endif
  let s:browser_opened = 1
  let s:port = str2nr(l:m[2])
  call s:log('presentation at ' . l:m[1])
  call s:open_browser(l:m[1])
endfunction

function! s:on_nvim_stdout(job_id, data, event) abort
  for l:line in a:data
    call s:try_open_from_output(l:line)
  endfor
endfunction

function! s:on_vim_stdout(channel, msg) abort
  call s:try_open_from_output(a:msg)
endfunction

function! s:warn_if_not_started() abort
  if !s:browser_opened
    call s:log('server did not report a URL within 4s -- check :messages and that `node` is on PATH')
  endif
endfunction

function! s:send_cursor_line() abort
  let s:cursor_timer = -1
  if s:port == 0
    return
  endif
  " Fire-and-forget over curl -- errors (e.g. curl missing) are discarded
  " rather than surfaced, since this fires on every cursor move and
  " shouldn't be noisy.
  let l:url = 'http://127.0.0.1:' . s:port . '/cursor?line=' . line('.')
  let l:cmd = ['curl', '-s', '-o', '/dev/null', l:url]
  if has('nvim')
    call jobstart(l:cmd)
  else
    call job_start(l:cmd, {'stoponexit': ''})
  endif
endfunction

function! s:on_cursor_moved() abort
  if !g:mdslides_follow_cursor || s:port == 0
    return
  endif
  if s:cursor_timer != -1
    call timer_stop(s:cursor_timer)
  endif
  " Debounce: cursor movement fires far more often than is useful to send.
  let s:cursor_timer = timer_start(80, {-> s:send_cursor_line()})
endfunction

function! mdslides#stop() abort
  if s:is_running()
    if has('nvim')
      call jobstop(s:job)
    else
      call job_stop(s:job)
    endif
    call s:log('stopped')
  endif
  let s:job = v:null
  if s:bufnr != -1 && bufexists(s:bufnr)
    augroup mdslides_autoupdate
      execute 'autocmd! * <buffer=' . s:bufnr . '>'
    augroup END
  endif
  let s:bufnr = -1
  if !empty(s:tempfile) && filereadable(s:tempfile)
    call delete(s:tempfile)
  endif
  let s:tempfile = ''
  let s:port = 0
  if s:cursor_timer != -1
    call timer_stop(s:cursor_timer)
    let s:cursor_timer = -1
  endif
endfunction

function! mdslides#start() abort
  if &filetype !=# 'markdown'
    call s:log('not a markdown buffer')
    return
  endif

  call mdslides#stop()

  let s:bufnr = bufnr('%')
  let s:tempfile = tempname() . '.mdslides.md'
  call s:write_buffer_to_temp()

  let l:server_js = s:app_dir . '/server.js'
  let l:assets_dir = expand('%:p:h')
  let l:cmd = ['node', l:server_js, s:tempfile, string(g:mdslides_port), l:assets_dir]
  let s:browser_opened = 0

  if has('nvim')
    let s:job = jobstart(l:cmd, {
          \ 'on_exit': function('s:on_job_exit'),
          \ 'on_stdout': function('s:on_nvim_stdout'),
          \ })
  else
    let s:job = job_start(l:cmd, {
          \ 'exit_cb': function('s:on_job_exit'),
          \ 'out_cb': function('s:on_vim_stdout'),
          \ 'stoponexit': 'term',
          \ })
  endif

  augroup mdslides_autoupdate
    execute 'autocmd! * <buffer=' . s:bufnr . '>'
    execute 'autocmd TextChanged,TextChangedI,InsertLeave,BufWritePost <buffer=' . s:bufnr . '> call mdslides#sync()'
    execute 'autocmd BufWipeout <buffer=' . s:bufnr . '> call mdslides#stop()'
    if g:mdslides_follow_cursor
      execute 'autocmd CursorMoved,CursorMovedI <buffer=' . s:bufnr . '> call s:on_cursor_moved()'
    endif
  augroup END

  call s:log('starting presentation...')

  " The server should announce its URL well within 4s; if it hasn't by
  " then, something's wrong (e.g. a fixed g:mdslides_port already in use,
  " or node missing) -- warn rather than silently doing nothing.
  call timer_start(4000, {-> s:warn_if_not_started()})
endfunction

function! s:open_browser(url) abort
  call system(g:mdslides_open_browser_cmd . ' ' . shellescape(a:url) . ' &')
endfunction

function! mdslides#sync() abort
  if s:bufnr == -1 || bufnr('%') != s:bufnr
    return
  endif
  call s:write_buffer_to_temp()
endfunction

function! mdslides#toggle() abort
  if s:is_running()
    call mdslides#stop()
  else
    call mdslides#start()
  endif
endfunction
