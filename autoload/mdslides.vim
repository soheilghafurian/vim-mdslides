" autoload/mdslides.vim
" Core logic for mdslides: renders the current markdown buffer as a
" reveal.js slide deck (one slide per heading) and live-updates it in the
" browser as you edit.

if !exists('g:mdslides_port')
  let g:mdslides_port = 8890
endif

if !exists('g:mdslides_slide_level')
  " Headings at or above this level start a new (horizontal) slide;
  " deeper headings become vertical sub-slides.
  let g:mdslides_slide_level = 1
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

function! s:on_server_output(url, ...) abort
  " Fires once the server process writes anything to stdout, which it does
  " right after it successfully binds its port.
  if s:browser_opened
    return
  endif
  let s:browser_opened = 1
  call s:open_browser(a:url)
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
  let l:cmd = ['node', l:server_js, s:tempfile, string(g:mdslides_port), string(g:mdslides_slide_level), l:assets_dir]
  let l:url = 'http://127.0.0.1:' . g:mdslides_port . '/'
  let s:browser_opened = 0

  if has('nvim')
    let s:job = jobstart(l:cmd, {
          \ 'on_exit': function('s:on_job_exit'),
          \ 'on_stdout': function('s:on_server_output', [l:url]),
          \ })
  else
    let s:job = job_start(l:cmd, {
          \ 'exit_cb': function('s:on_job_exit'),
          \ 'out_cb': function('s:on_server_output', [l:url]),
          \ 'stoponexit': 'term',
          \ })
  endif

  augroup mdslides_autoupdate
    execute 'autocmd! * <buffer=' . s:bufnr . '>'
    execute 'autocmd TextChanged,TextChangedI,InsertLeave,BufWritePost <buffer=' . s:bufnr . '> call mdslides#sync()'
    execute 'autocmd BufWipeout <buffer=' . s:bufnr . '> call mdslides#stop()'
  augroup END

  call s:log('starting presentation at ' . l:url)

  " Fallback in case the server is slow to produce output or the platform's
  " stdout callback never fires: open the browser anyway after a few seconds.
  call timer_start(4000, {-> s:on_server_output(l:url)})
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
