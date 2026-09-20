" plugin/mdslides.vim
" Present the current markdown buffer in the browser as a reveal.js deck,
" one slide per heading, live-updating as you edit -- like :MarkdownPreview
" but for slides.

if exists('g:loaded_mdslides')
  finish
endif
let g:loaded_mdslides = 1

command! -bar MDSlidesStart call mdslides#start()
command! -bar MDSlidesStop call mdslides#stop()
command! -bar MDSlidesToggle call mdslides#toggle()

augroup mdslides_cleanup
  autocmd!
  autocmd VimLeavePre * call mdslides#stop()
augroup END
