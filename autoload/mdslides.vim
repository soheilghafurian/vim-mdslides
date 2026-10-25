" autoload/mdslides.vim
" Core logic for mdslides: renders the current markdown buffer in the
" browser, live-updating as you edit, in one of two modes -- 'slides' (a
" reveal.js deck, one slide per heading) or 'document' (a continuous,
" normally-scrolling document). Each buffer has its own session (server,
" port and browser tab), so e.g. `:bufdo MDSlidesStart` opens one rendering
" per buffer; starting a buffer that's already presenting restarts just
" that buffer's session.

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
" One session per buffer, keyed by buffer number (as a string). Each is a
" dict: job, tempfile, port, mode ('slides' or 'document'), browser_opened,
" initial_line, cursor_timer.
let s:sessions = {}

function! s:log(msg) abort
  echom '[mdslides] ' . a:msg
endfunction

function! s:is_running(session) abort
  if empty(a:session) || empty(a:session.job)
    return 0
  endif
  if has('nvim')
    return jobwait([a:session.job], 0)[0] == -1
  endif
  return job_status(a:session.job) ==# 'run'
endfunction

function! s:write_buffer_to_temp(bufnr, tempfile) abort
  call writefile(getbufline(a:bufnr, 1, '$'), a:tempfile)
endfunction

function! s:on_job_exit(bufnr, ...) abort
  let l:session = get(s:sessions, a:bufnr, {})
  if !empty(l:session)
    let l:session.job = v:null
  endif
endfunction

function! s:try_open_from_output(bufnr, text) abort
  " The server prints its actual bound URL once it's listening -- actual,
  " because with the default g:mdslides_port of 0 the OS picks a free port,
  " so each concurrent mdslides instance (one per Vim buffer presenting at
  " once) gets its own port instead of colliding on a shared one. Parse it
  " out rather than assuming a URL up front. Keep this pattern in sync with
  " the message app/server.js logs on listen.
  let l:session = get(s:sessions, a:bufnr, {})
  if empty(l:session) || l:session.browser_opened
    return
  endif
  let l:m = matchlist(a:text, 'listening on \(http://127\.0\.0\.1:\(\d\+\)/\?\)')
  if empty(l:m)
    return
  endif
  let l:session.browser_opened = 1
  let l:session.port = str2nr(l:m[2])
  call s:log('presentation at ' . l:m[1])
  " Open on the slide the cursor was on when :MDSlidesStart was invoked,
  " rather than always the first slide.
  call s:open_browser(l:m[1] . '?line=' . l:session.initial_line)
endfunction

function! s:on_nvim_stdout(bufnr, job_id, data, event) abort
  for l:line in a:data
    call s:try_open_from_output(a:bufnr, l:line)
  endfor
endfunction

function! s:on_vim_stdout(bufnr, channel, msg) abort
  call s:try_open_from_output(a:bufnr, a:msg)
endfunction

function! s:warn_if_not_started(bufnr, ...) abort
  let l:session = get(s:sessions, a:bufnr, {})
  if !empty(l:session) && !l:session.browser_opened
    call s:log('server did not report a URL within 4s -- check :messages and that `node` is on PATH')
  endif
endfunction

function! s:send_cursor_line(bufnr, ...) abort
  let l:session = get(s:sessions, a:bufnr, {})
  if empty(l:session)
    return
  endif
  let l:session.cursor_timer = -1
  if l:session.port == 0
    return
  endif
  " Fire-and-forget over curl -- errors (e.g. curl missing) are discarded
  " rather than surfaced, since this fires on every cursor move and
  " shouldn't be noisy.
  let l:url = 'http://127.0.0.1:' . l:session.port . '/cursor?line=' . line('.')
  let l:cmd = ['curl', '-s', '-o', '/dev/null', l:url]
  if has('nvim')
    call jobstart(l:cmd)
  else
    call job_start(l:cmd, {'stoponexit': ''})
  endif
endfunction

function! s:on_cursor_moved() abort
  let l:bufnr = bufnr('%')
  let l:session = get(s:sessions, l:bufnr, {})
  if !g:mdslides_follow_cursor || empty(l:session) || l:session.port == 0
    return
  endif
  if l:session.cursor_timer != -1
    call timer_stop(l:session.cursor_timer)
  endif
  " Debounce: cursor movement fires far more often than is useful to send.
  let l:session.cursor_timer = timer_start(80, function('s:send_cursor_line', [l:bufnr]))
endfunction

function! s:stop_session(bufnr) abort
  let l:session = get(s:sessions, a:bufnr, {})
  if empty(l:session)
    return
  endif
  if s:is_running(l:session)
    if has('nvim')
      call jobstop(l:session.job)
    else
      call job_stop(l:session.job)
    endif
    call s:log('stopped')
  endif
  if bufexists(a:bufnr)
    augroup mdslides_autoupdate
      execute 'autocmd! * <buffer=' . a:bufnr . '>'
    augroup END
  endif
  if !empty(l:session.tempfile) && filereadable(l:session.tempfile)
    call delete(l:session.tempfile)
  endif
  if l:session.cursor_timer != -1
    call timer_stop(l:session.cursor_timer)
  endif
  call remove(s:sessions, a:bufnr)
endfunction

" Stops the current buffer's session, or the one for buffer a:1 if given.
function! mdslides#stop(...) abort
  call s:stop_session(a:0 > 0 ? a:1 : bufnr('%'))
endfunction

function! mdslides#stop_all() abort
  for l:bufnr in keys(s:sessions)
    call s:stop_session(str2nr(l:bufnr))
  endfor
endfunction

function! mdslides#start(...) abort
  " Optional first arg: 'slides' (default) or 'document'.
  let l:mode = a:0 > 0 ? a:1 : 'slides'

  if &filetype !=# 'markdown'
    call s:log('not a markdown buffer')
    return
  endif

  let l:bufnr = bufnr('%')
  " Restart only this buffer's session; other buffers' keep running.
  call s:stop_session(l:bufnr)

  let l:session = {
        \ 'job': v:null,
        \ 'tempfile': tempname() . '.mdslides.md',
        \ 'port': 0,
        \ 'mode': l:mode,
        \ 'browser_opened': 0,
        \ 'initial_line': line('.'),
        \ 'cursor_timer': -1,
        \ }
  let s:sessions[l:bufnr] = l:session
  call s:write_buffer_to_temp(l:bufnr, l:session.tempfile)

  let l:server_js = s:app_dir . '/server.js'
  let l:assets_dir = expand('%:p:h')
  let l:cmd = ['node', l:server_js, l:session.tempfile, string(g:mdslides_port), l:assets_dir, l:mode]

  if has('nvim')
    let l:session.job = jobstart(l:cmd, {
          \ 'on_exit': function('s:on_job_exit', [l:bufnr]),
          \ 'on_stdout': function('s:on_nvim_stdout', [l:bufnr]),
          \ })
  else
    let l:session.job = job_start(l:cmd, {
          \ 'exit_cb': function('s:on_job_exit', [l:bufnr]),
          \ 'out_cb': function('s:on_vim_stdout', [l:bufnr]),
          \ 'stoponexit': 'term',
          \ })
  endif

  augroup mdslides_autoupdate
    execute 'autocmd! * <buffer=' . l:bufnr . '>'
    execute 'autocmd TextChanged,TextChangedI,InsertLeave,BufWritePost <buffer=' . l:bufnr . '> call mdslides#sync()'
    " :e (or autoread) reloading the file from disk doesn't fire TextChanged,
    " so pick those reloads up explicitly.
    execute 'autocmd BufReadPost,FileChangedShellPost <buffer=' . l:bufnr . '> call mdslides#sync()'
    execute 'autocmd BufWipeout <buffer=' . l:bufnr . '> call mdslides#stop(' . l:bufnr . ')'
    if g:mdslides_follow_cursor
      execute 'autocmd CursorMoved,CursorMovedI <buffer=' . l:bufnr . '> call s:on_cursor_moved()'
    endif
  augroup END

  call s:log('starting presentation...')

  " The server should announce its URL well within 4s; if it hasn't by
  " then, something's wrong (e.g. a fixed g:mdslides_port already in use,
  " or node missing) -- warn rather than silently doing nothing.
  call timer_start(4000, function('s:warn_if_not_started', [l:bufnr]))
endfunction

function! s:open_browser(url) abort
  call system(g:mdslides_open_browser_cmd . ' ' . shellescape(a:url) . ' &')
endfunction

function! mdslides#sync() abort
  let l:bufnr = bufnr('%')
  let l:session = get(s:sessions, l:bufnr, {})
  if empty(l:session)
    return
  endif
  call s:write_buffer_to_temp(l:bufnr, l:session.tempfile)
endfunction

function! mdslides#toggle(...) abort
  " Optional first arg: 'slides' (default) or 'document'.
  let l:mode = a:0 > 0 ? a:1 : 'slides'

  " Only stop if this buffer is already presenting *in the requested mode*
  " -- otherwise (not presenting, or presenting in the *other* mode) switch
  " straight to presenting it in the requested mode, rather than requiring
  " a stop-then-start dance.
  let l:session = get(s:sessions, bufnr('%'), {})
  if s:is_running(l:session) && l:session.mode ==# l:mode
    call mdslides#stop()
  else
    call mdslides#start(l:mode)
  endif
endfunction
